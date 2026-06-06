-- Tense initial schema: the bi-temporal graph foundation (ADR 0001, ADR 0002).
--
-- One Postgres holds everything: relational Entity/Fact/Source tables plus the
-- extensions for hybrid recall (pgvector) and fuzzy entity resolution (pg_trgm).

CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Source: a chunk of ingested text. Every Fact traces back to one for provenance.
CREATE TABLE IF NOT EXISTS sources (
    id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    label      text,
    text       text        NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);

-- Entity: a distinct thing Facts connect (person, document, feature, ...).
-- Carries immutable identifying properties only; anything that changes over time
-- is a Fact, not an attribute. `normalized_name` backs exact-match resolution;
-- pg_trgm fuzzy matching (slice 06) builds on the same column.
CREATE TABLE IF NOT EXISTS entities (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name            text        NOT NULL,
    normalized_name text        NOT NULL,
    created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_entities_normalized_name
    ON entities (normalized_name);

-- Fact: a directed, typed relationship subject -> predicate -> object, the only
-- thing that can be superseded. Bi-temporal:
--   valid time      (valid_at / invalid_at)  -- when it was true IN THE WORLD
--   transaction time(created_at / expired_at) -- when the SYSTEM held it current
-- A Fact is Current iff expired_at IS NULL. Facts are expired, never deleted.
CREATE TABLE IF NOT EXISTS facts (
    id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    subject_id uuid        NOT NULL REFERENCES entities (id),
    predicate  text        NOT NULL,
    object_id  uuid        NOT NULL REFERENCES entities (id),
    source_id  uuid        NOT NULL REFERENCES sources (id),

    -- valid time (extracted from Source content; nullable — see degenerate
    -- valid_at policy in ADR 0002 / slice 03).
    valid_at   timestamptz,
    invalid_at timestamptz,

    -- transaction time (wall-clock, system-generated).
    created_at timestamptz NOT NULL DEFAULT now(),
    expired_at timestamptz
);

-- The Current partial index: the heart of "which version is true now". Every
-- read of Current state (recall default, viewer, supersession lookup) goes
-- through `expired_at IS NULL`; the viewer must use this exact definition, never
-- `invalid_at IS NULL` (slice 08).
CREATE INDEX IF NOT EXISTS idx_facts_current
    ON facts (subject_id, predicate)
    WHERE expired_at IS NULL;

-- Provenance lookups and history chains scan by subject/predicate over all time.
CREATE INDEX IF NOT EXISTS idx_facts_subject_predicate
    ON facts (subject_id, predicate);

CREATE INDEX IF NOT EXISTS idx_facts_source
    ON facts (source_id);
