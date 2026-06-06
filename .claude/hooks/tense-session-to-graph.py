#!/usr/bin/env python3
"""
Tense SessionEnd hook — summarize the just-ended session into durable facts and
feed them to the temporal graph, so the viewer shows the "brain" grow.

  session ends -> this hook (fast) -> detached worker
                    -> guarded `claude -p` summarizes the transcript
                    -> POST the summary to the viewer's /api/remember
                    -> Tense extracts Entities/Facts; the viewer animates growth

RECURSION-PROOF BY CONSTRUCTION (a recursive hook once drained the usage limit;
see memory `session-end-hook-no-recursion` / ADR 0004):

  * The worker launches `claude -p` with TENSE_SESSION_HOOK=1 in the child's env.
  * This hook's FIRST action is to exit(0) whenever TENSE_SESSION_HOOK is set.
  * So the summarizer's own SessionEnd re-enters this hook and immediately exits.

The only way to loop would be for the child's SessionEnd to fire AND the env var
to not propagate — but subprocess passes env explicitly, so neither half holds.
If SessionEnd never fires for `-p` at all, there is no loop either. Recursion is
unreachable. Belt-and-suspenders: single-flight lock + hard timeout + detach.

Silent on failure — a hook must never disrupt session exit.

Config (env, all optional — used by the test harness):
  TENSE_CLAUDE_BIN     summarizer binary           (default: claude)
  TENSE_SUMMARY_MODEL  model alias for the summary  (default: haiku)
  TENSE_REMEMBER_URL   ingestion endpoint           (default: http://localhost:3000/api/remember)
  TENSE_HOOK_DEBUG=1   log to stderr
"""

import fcntl
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

GUARD = "TENSE_SESSION_HOOK"
CLAUDE_BIN = os.environ.get("TENSE_CLAUDE_BIN", "claude")
SUMMARY_MODEL = os.environ.get("TENSE_SUMMARY_MODEL", "haiku")
REMEMBER_URL = os.environ.get("TENSE_REMEMBER_URL", "http://localhost:3000/api/remember")
LOCK_PATH = Path(os.environ.get("TENSE_HOOK_LOCK", "/tmp/tense-session-hook.lock"))
LOG_PATH = Path(os.environ.get("TENSE_HOOK_LOG", "/tmp/tense-hook.log"))
MIN_TRANSCRIPT_CHARS = 200   # skip trivial sessions
MAX_TRANSCRIPT_CHARS = 60000 # cover most of a session (favour the tail if larger)
SUMMARY_TIMEOUT = 90
DEBUG = os.environ.get("TENSE_HOOK_DEBUG") == "1"

SUMMARY_PROMPT = """You are distilling a Claude Code coding session into durable long-term memory.

From the transcript below, extract only DURABLE facts worth remembering across future sessions: decisions made, the user's stated preferences, what projects/features exist and what they are for, tools/libraries chosen, and relationships between people, projects, or components. Ignore transient chatter, debugging steps, and anything ephemeral.

Output each fact as ONE short declarative sentence in plain subject-predicate-object form (e.g. "Zach prefers pnpm.", "Tense stores facts in Postgres.", "The viewer polls every second."). One fact per line. No bullets, no numbering, no commentary, no preamble.

If there is nothing durable worth remembering, output exactly: NONE

Do not use any tools. Do not read files. Base the facts only on the transcript."""


def log(msg: str) -> None:
    # Always leave a breadcrumb in a file (SessionEnd stderr is discarded), so we
    # can always tell whether — and when — the hook actually ran.
    try:
        stamp = datetime.now().astimezone().isoformat(timespec="seconds")
        with open(LOG_PATH, "a", encoding="utf-8") as f:
            f.write(f"{stamp} [{os.getpid()}] {msg}\n")
    except Exception:
        pass
    if DEBUG:
        print(f"[tense-session-hook] {msg}", file=sys.stderr)


def log_block(title: str, body: str) -> None:
    """Record a multi-line payload (e.g. the raw summariser output) in the log,
    fenced and indented so the exact text is easy to read with `tail`/`cat`."""
    try:
        stamp = datetime.now().astimezone().isoformat(timespec="seconds")
        tag = f"{stamp} [{os.getpid()}]"
        with open(LOG_PATH, "a", encoding="utf-8") as f:
            f.write(f"{tag} ┌── {title} ──\n")
            for line in (body.splitlines() or [""]):
                f.write(f"{tag} │ {line}\n")
            f.write(f"{tag} └── end {title} ──\n")
    except Exception:
        pass
    if DEBUG:
        print(f"[tense-session-hook] {title}:\n{body}", file=sys.stderr)


# --- transcript parsing (mirrors transcript-to-brain.py) -------------------

SECRET_PATTERNS = [
    re.compile(r"\bxapp-[A-Za-z0-9-]+", re.I),
    re.compile(r"\bxox[abeprs]-[A-Za-z0-9-]+", re.I),
    re.compile(r"\bsk-[A-Za-z0-9_-]{20,}", re.I),
    re.compile(r"\bgh[pousr]_[A-Za-z0-9]{30,}", re.I),
    re.compile(r"\bAKIA[0-9A-Z]{16}\b"),
    re.compile(r"\bAIza[0-9A-Za-z_-]{30,}\b"),
    re.compile(r"\beyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\b"),
]


def redact(text: str) -> str:
    for pat in SECRET_PATTERNS:
        text = pat.sub("[REDACTED-SECRET]", text)
    return text


def strip_noise(text: str) -> str:
    text = re.sub(r"<local-command-caveat>.*?</local-command-caveat>", "", text, flags=re.S)
    text = re.sub(r"<system-reminder>.*?</system-reminder>", "", text, flags=re.S)
    text = re.sub(r"<command-name>.*?</command-args>", "", text, flags=re.S)
    return redact(text.strip())


def _text_of(entry: dict) -> str:
    msg = entry.get("message") or {}
    content = msg.get("content")
    if isinstance(content, str):
        return strip_noise(content)
    if isinstance(content, list):
        parts = []
        for block in content:
            if isinstance(block, dict) and block.get("type") == "text":
                parts.append(strip_noise(block.get("text", "")))
        return "\n".join(p for p in parts if p)
    return ""


def build_transcript_text(transcript_path: Path) -> str:
    """Plain User/Assistant text only — no thinking, no tool noise — for a clean,
    cheap summary. Capped to the most recent MAX_TRANSCRIPT_CHARS."""
    lines: list[str] = []
    with transcript_path.open("r", encoding="utf-8") as f:
        for raw in f:
            raw = raw.strip()
            if not raw:
                continue
            try:
                entry = json.loads(raw)
            except json.JSONDecodeError:
                continue
            etype = entry.get("type")
            if etype == "user" and not entry.get("isMeta") and not entry.get("sourceToolUseID"):
                t = _text_of(entry)
                if t:
                    lines.append(f"User: {t}")
            elif etype == "assistant":
                t = _text_of(entry)
                if t:
                    lines.append(f"Assistant: {t}")
    text = "\n\n".join(lines)
    if len(text) > MAX_TRANSCRIPT_CHARS:
        text = text[-MAX_TRANSCRIPT_CHARS:]
    return text


# --- worker ----------------------------------------------------------------

def acquire_lock_or_exit():
    """Single-flight: if a summarizer is already running, exit quietly."""
    fd = open(LOCK_PATH, "w")
    try:
        fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except OSError:
        log("another summarizer holds the lock; exiting")
        sys.exit(0)
    return fd  # keep referenced so the lock is held for the process lifetime


def run_summary(transcript_text: str) -> str:
    # `--strict-mcp-config` (with no --mcp-config) loads NO MCP servers. Running in
    # a throwaway cwd means the summarizer can't read this repo (cleaner facts) and
    # never loads the project's hooks at all — a second, independent barrier to
    # recursion on top of the TENSE_SESSION_HOOK env guard. NOT `--bare`: that
    # disables OAuth/keychain auth (verified via `claude --help`), which we rely on.
    cmd = [CLAUDE_BIN, "-p", "--model", SUMMARY_MODEL, "--strict-mcp-config", SUMMARY_PROMPT]
    scratch = tempfile.mkdtemp(prefix="tense-summary-")
    log(f"summarizing {len(transcript_text)} transcript chars via {CLAUDE_BIN} ({SUMMARY_MODEL}) in {scratch}")
    try:
        proc = subprocess.run(
            cmd,
            input=transcript_text,
            capture_output=True,
            text=True,
            timeout=SUMMARY_TIMEOUT,
            cwd=scratch,
        )
    finally:
        shutil.rmtree(scratch, ignore_errors=True)
    out = (proc.stdout or "").strip()
    if proc.returncode != 0:
        log(f"summarizer exited {proc.returncode}; stderr: {(proc.stderr or '').strip()[:300]}")
    # The raw distillation is otherwise discarded — record it so you can see exactly
    # what the summariser produced, even when it's NONE or gets rejected before ingest.
    log_block("summariser output", out or "(empty)")
    return out


def is_meaningful(summary: str) -> bool:
    # The model sometimes emits the NONE sentinel and then keeps rambling; treat a
    # leading NONE token (as a word) as "nothing durable", so chatter isn't ingested.
    s = summary.strip()
    if not s:
        return False
    return re.match(r"(?i)none\b", s) is None


def post_remember(summary: str, label: str) -> None:
    body = json.dumps({"text": summary, "source": label}).encode("utf-8")
    req = urllib.request.Request(
        REMEMBER_URL, data=body, headers={"content-type": "application/json"}, method="POST"
    )
    with urllib.request.urlopen(req, timeout=30) as resp:
        raw = resp.read().decode("utf-8", "replace")
        log(f"remember -> HTTP {resp.status} as \"{label}\"")
        log_block("ingest result", raw.strip() or "(empty)")


def worker(transcript_path: str, cwd: str) -> None:
    lock = acquire_lock_or_exit()  # noqa: F841 (held for process lifetime)
    tp = Path(transcript_path)
    if not tp.exists():
        log(f"transcript gone: {tp}")
        return
    text = build_transcript_text(tp)
    if len(text) < MIN_TRANSCRIPT_CHARS:
        log(f"transcript too short ({len(text)} chars); skipping")
        return
    try:
        summary = run_summary(text)
    except subprocess.TimeoutExpired:
        log("summary timed out; skipping")
        return
    except Exception as e:  # noqa: BLE001
        log(f"summary failed: {e}")
        return
    if not is_meaningful(summary):
        log("no durable facts (NONE/empty); skipping ingest")
        return
    date = datetime.now(timezone.utc).astimezone().strftime("%Y-%m-%d")
    project = Path(cwd).name if cwd else "session"
    label = f"claude-session · {date} · {project}"
    try:
        post_remember(summary, label)
    except Exception as e:  # noqa: BLE001
        log(f"ingest failed (viewer down?): {e}")


# --- hook entry ------------------------------------------------------------

def hook_entry() -> int:
    log("SessionEnd hook invoked")
    # PRIMARY recursion guard: the summarizer child inherits this; its own
    # SessionEnd re-enters here and stops dead before doing anything.
    if os.environ.get(GUARD):
        log("guard set (inside summarizer child); exiting — no recursion")
        return 0

    try:
        payload = json.load(sys.stdin)
    except Exception as e:  # noqa: BLE001
        log(f"no stdin json: {e}")
        return 0
    if not isinstance(payload, dict):
        return 0
    if payload.get("stop_hook_active"):  # belt: never re-enter on a nested stop
        return 0

    transcript_path = payload.get("transcript_path")
    cwd = payload.get("cwd") or ""
    if not transcript_path or not Path(transcript_path).exists():
        log("no usable transcript_path; nothing to do")
        return 0

    # Detach the slow work (LLM + HTTP) so session exit isn't blocked. The child
    # carries the guard var, making the summarizer's SessionEnd a no-op.
    env = {**os.environ, GUARD: "1"}
    subprocess.Popen(
        [sys.executable, __file__, "--worker", transcript_path, cwd],
        env=env,
        stdin=subprocess.DEVNULL,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        start_new_session=True,
    )
    log("spawned detached summarizer worker")
    return 0


def main() -> int:
    if len(sys.argv) >= 3 and sys.argv[1] == "--worker":
        worker(sys.argv[2], sys.argv[3] if len(sys.argv) > 3 else "")
        return 0
    return hook_entry()


if __name__ == "__main__":
    try:
        sys.exit(main())
    except SystemExit:
        raise
    except Exception as e:  # noqa: BLE001 — a hook must never crash the session
        log(f"fatal: {e}")
        sys.exit(0)
