#!/usr/bin/env python3
"""
Recursion-safety + behavior verification for tense-session-to-graph.py.

Uses a STUB `claude` and a MOCK /api/remember receiver, so it spends ZERO real
Claude usage and never touches the real viewer/graph. Proves:

  A. Guard: with TENSE_SESSION_HOOK set, the hook exits and spawns nothing.
  B. Propagation: the summarizer child is invoked WITH TENSE_SESSION_HOOK=1.
     (A + B together => recursion is unreachable: the child has the guard, and a
      hook run with the guard does nothing.)
  C. Ingest: a real summary is POSTed to /api/remember.
  D. NONE-skip: a "NONE" summary ingests nothing.
  E. Single-flight: a second worker exits while the lock is held.
  F. End-to-end: hook_entry detaches a worker that completes the POST.
"""

import http.server
import json
import os
import socket
import subprocess
import sys
import tempfile
import threading
import time
from pathlib import Path

HOOK = Path(__file__).resolve().parents[2] / ".claude" / "hooks" / "tense-session-to-graph.py"
TMP = Path(tempfile.mkdtemp(prefix="tense-hook-verify-"))
RECEIVED: list[dict] = []
PASS, FAIL = [], []


def check(name: str, ok: bool, detail: str = "") -> None:
    (PASS if ok else FAIL).append(name)
    print(f"  {'✓' if ok else '✗'} {name}{(' — ' + detail) if detail else ''}")


# --- mock /api/remember receiver -------------------------------------------

class Handler(http.server.BaseHTTPRequestHandler):
    def do_POST(self):
        n = int(self.headers.get("content-length", 0))
        try:
            RECEIVED.append(json.loads(self.rfile.read(n) or b"{}"))
        except Exception:
            RECEIVED.append({"_unparsed": True})
        self.send_response(200)
        self.send_header("content-type", "application/json")
        self.end_headers()
        self.wfile.write(b'{"factsCreated":[{"id":"x"}],"factsSuperseded":[],"factsReaffirmed":[]}')

    def log_message(self, *a):  # silence
        pass


def free_port() -> int:
    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    p = s.getsockname()[1]
    s.close()
    return p


# --- stub claude + fixtures ------------------------------------------------

STUB = TMP / "claude_stub.py"
STUB.write_text(
    "#!/usr/bin/env python3\n"
    "import os, sys\n"
    "sys.stdin.read()\n"  # consume transcript on stdin
    "mode = os.environ.get('STUB_MODE', 'summary')\n"
    # Prove the guard env propagated into the summarizer child:
    "open(os.environ['STUB_GUARD_OUT'], 'w').write(os.environ.get('TENSE_SESSION_HOOK', 'MISSING'))\n"
    "print('NONE' if mode == 'none' else 'Xavier reports to Yvonne.\\nTense uses Postgres.')\n",
    encoding="utf-8",
)
STUB.chmod(0o755)
STUB_CLAUDE = f"{sys.executable} {STUB}"

TRANSCRIPT = TMP / "transcript.jsonl"
TRANSCRIPT.write_text(
    "\n".join(
        json.dumps(e)
        for e in [
            {"type": "user", "message": {"role": "user", "content": "Let's build the Tense session hook and watch the graph grow."}},
            {"type": "assistant", "message": {"role": "assistant", "content": [{"type": "text", "text": "We decided the viewer hosts ingestion and Tense stores facts in Postgres. " * 8}]}},
        ]
    ),
    encoding="utf-8",
)


def base_env(port: int, mode: str = "summary", lock: str | None = None) -> dict:
    guard_out = TMP / f"guard-{mode}-{time.time_ns()}.txt"
    env = {
        **os.environ,
        "TENSE_CLAUDE_BIN_UNUSED": "1",
        "TENSE_REMEMBER_URL": f"http://127.0.0.1:{port}/api/remember",
        "TENSE_HOOK_LOCK": lock or str(TMP / "lock"),
        "STUB_MODE": mode,
        "STUB_GUARD_OUT": str(guard_out),
        "TENSE_HOOK_DEBUG": "1",
    }
    # The hook splits TENSE_CLAUDE_BIN on spaces? No — it's argv[0]. Our stub needs
    # two tokens (python + script), so wrap via a one-line shim script instead.
    shim = TMP / f"claude-shim-{mode}.sh"
    shim.write_text(f'#!/bin/sh\nexec {STUB_CLAUDE} "$@"\n', encoding="utf-8")
    shim.chmod(0o755)
    env["TENSE_CLAUDE_BIN"] = str(shim)
    env["_GUARD_OUT"] = str(guard_out)
    return env


def run(args: list[str], env: dict, stdin: str = "") -> subprocess.CompletedProcess:
    return subprocess.run(
        [sys.executable, str(HOOK), *args],
        input=stdin, env=env, capture_output=True, text=True, timeout=60,
    )


def main() -> int:
    port = free_port()
    srv = http.server.ThreadingHTTPServer(("127.0.0.1", port), Handler)
    threading.Thread(target=srv.serve_forever, daemon=True).start()

    print("Verifying tense-session-to-graph.py (stub claude, mock receiver)\n")

    # A. Guard short-circuits hook_entry; nothing spawned.
    RECEIVED.clear()
    env = base_env(port)
    env["TENSE_SESSION_HOOK"] = "1"
    payload = json.dumps({"transcript_path": str(TRANSCRIPT), "cwd": str(TMP)})
    r = run([], env, stdin=payload)
    time.sleep(1.0)
    check("A guard: GUARD set -> exit 0, no ingest", r.returncode == 0 and len(RECEIVED) == 0,
          f"rc={r.returncode} received={len(RECEIVED)}")

    # C. Worker (sync) with a real summary -> POST with a session label.
    RECEIVED.clear()
    env = base_env(port, mode="summary")
    run(["--worker", str(TRANSCRIPT), str(TMP)], env)
    got = RECEIVED[-1] if RECEIVED else {}
    check("C ingest: summary POSTed to /api/remember", len(RECEIVED) == 1 and "Tense uses Postgres." in got.get("text", ""),
          f"received={len(RECEIVED)}")
    check("  (label looks like a session source)", got.get("source", "").startswith("claude-session"),
          got.get("source", ""))

    # D. NONE summary -> no ingest.
    RECEIVED.clear()
    env = base_env(port, mode="none")
    run(["--worker", str(TRANSCRIPT), str(TMP)], env)
    check("D NONE-skip: nothing ingested", len(RECEIVED) == 0, f"received={len(RECEIVED)}")

    # E. Single-flight: hold the lock, worker should bail.
    RECEIVED.clear()
    import fcntl
    lockp = TMP / "held.lock"
    held = open(lockp, "w")
    fcntl.flock(held, fcntl.LOCK_EX | fcntl.LOCK_NB)
    env = base_env(port, mode="summary", lock=str(lockp))
    run(["--worker", str(TRANSCRIPT), str(TMP)], env)
    check("E single-flight: contended lock -> no ingest", len(RECEIVED) == 0, f"received={len(RECEIVED)}")
    held.close()

    # F. End-to-end via hook_entry: it must set GUARD=1 on the detached worker,
    # which the summarizer child then inherits — the real recursion-proof path.
    RECEIVED.clear()
    env = base_env(port, mode="summary")
    env.pop("TENSE_SESSION_HOOK", None)
    r = run([], env, stdin=json.dumps({"transcript_path": str(TRANSCRIPT), "cwd": str(TMP)}))
    deadline = time.time() + 10
    while time.time() < deadline and not RECEIVED:
        time.sleep(0.2)
    check("F end-to-end: detached worker completed the POST", len(RECEIVED) == 1,
          f"rc={r.returncode} received={len(RECEIVED)}")
    guard_seen = Path(env["_GUARD_OUT"]).read_text().strip() if Path(env["_GUARD_OUT"]).exists() else "NO-FILE"
    check("B propagation: summarizer child saw TENSE_SESSION_HOOK=1 (real flow)",
          guard_seen == "1", f"guard_seen={guard_seen!r}")

    srv.shutdown()
    print(f"\n{len(PASS)} passed, {len(FAIL)} failed")
    if FAIL:
        print("FAILED:", ", ".join(FAIL))
        return 1
    print("RECURSION-PROOF: child carries the guard (B) AND a guarded hook run is a no-op (A).")
    return 0


if __name__ == "__main__":
    sys.exit(main())
