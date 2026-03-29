-- ============================================
-- UNCIVILISED — Complete Supabase Schema
-- ============================================
-- Run this in Supabase SQL Editor to set up the database from scratch.
-- Safe to re-run: uses IF NOT EXISTS / CREATE OR REPLACE throughout.
--
-- Last updated: 2026-03-27
-- Tables: players, leaderboard, game_saves, game_sessions, waitlist,
--         feedback, diplomacy_interactions, competitions, active_games,
--         chat_rate_limits

-- ═══════════════════════════════════════════════════
-- Extensions
-- ═══════════════════════════════════════════════════

CREATE EXTENSION IF NOT EXISTS vector;  -- pgvector for feedback embeddings

-- ═══════════════════════════════════════════════════
-- PLAYERS
-- ═══════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS players (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  username      TEXT NOT NULL,
  username_lower TEXT NOT NULL UNIQUE,
  email         TEXT,
  email_verified BOOLEAN NOT NULL DEFAULT false,
  access_token  UUID DEFAULT gen_random_uuid(),
  status        TEXT NOT NULL DEFAULT 'waitlisted'
                  CHECK (status IN ('active', 'waitlisted', 'suspended')),
  role          TEXT NOT NULL DEFAULT 'user'
                  CHECK (role IN ('user', 'admin', 'dev')),
  games_played  INTEGER NOT NULL DEFAULT 0,
  best_score    INTEGER NOT NULL DEFAULT 0,
  total_score   INTEGER NOT NULL DEFAULT 0,
  email_opt_out BOOLEAN NOT NULL DEFAULT false,
  last_active   TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_players_access_token ON players (access_token);
CREATE INDEX IF NOT EXISTS idx_players_status ON players (status);

-- ═══════════════════════════════════════════════════
-- COMPETITIONS
-- ═══════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS competitions (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name       TEXT NOT NULL,
  status     TEXT NOT NULL DEFAULT 'active',
  starts_at  TIMESTAMPTZ NOT NULL,
  ends_at    TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ═══════════════════════════════════════════════════
-- LEADERBOARD
-- ═══════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS leaderboard (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  player_name         TEXT NOT NULL,
  score               INTEGER NOT NULL DEFAULT 0,
  turns_played        INTEGER NOT NULL DEFAULT 0,
  victory_type        TEXT,
  factions_eliminated INTEGER NOT NULL DEFAULT 0,
  cities_count        INTEGER NOT NULL DEFAULT 0,
  game_version        TEXT,
  competition_id      UUID REFERENCES competitions(id),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ═══════════════════════════════════════════════════
-- GAME SAVES
-- ═══════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS game_saves (
  visitor_id TEXT PRIMARY KEY,
  game_state JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ═══════════════════════════════════════════════════
-- GAME SESSIONS (analytics)
-- ═══════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS game_sessions (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  visitor_id   TEXT NOT NULL,
  game_mode    TEXT,
  started_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at     TIMESTAMPTZ,
  turns_played INTEGER,
  outcome      TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ═══════════════════════════════════════════════════
-- ACTIVE GAMES (competition session tracking)
-- ═══════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS active_games (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  player_name     TEXT NOT NULL,
  competition_id  UUID NOT NULL REFERENCES competitions(id),
  game_id         TEXT NOT NULL,
  sessions_used   INTEGER NOT NULL DEFAULT 1,
  max_sessions    INTEGER NOT NULL DEFAULT 3,
  turn            INTEGER NOT NULL DEFAULT 1,
  score           INTEGER NOT NULL DEFAULT 0,
  finished        BOOLEAN NOT NULL DEFAULT false,
  last_session_at TIMESTAMPTZ,
  started_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ═══════════════════════════════════════════════════
-- WAITLIST
-- ═══════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS waitlist (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email      TEXT NOT NULL,
  source     TEXT NOT NULL DEFAULT 'website',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ═══════════════════════════════════════════════════
-- DIPLOMACY INTERACTIONS
-- ═══════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS diplomacy_interactions (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  visitor_id     TEXT NOT NULL,
  character_id   TEXT NOT NULL,
  player_message TEXT NOT NULL,
  ai_reply       TEXT NOT NULL,
  action_type    TEXT,
  action_data    JSONB,
  turn           INTEGER NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ═══════════════════════════════════════════════════
-- FEEDBACK (with pgvector embeddings for triage)
-- ═══════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS feedback (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  visitor_id           TEXT,
  player_name          TEXT,
  message              TEXT NOT NULL,
  category             TEXT,
  priority             TEXT DEFAULT 'medium',
  ai_summary           TEXT,
  ai_response          TEXT,
  game_state_snapshot  JSONB,
  status               TEXT NOT NULL DEFAULT 'new',
  embedding            vector(768),
  github_issue_number  INTEGER,
  thanked_at           TIMESTAMPTZ,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_feedback_embedding
  ON feedback USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 10);

CREATE INDEX IF NOT EXISTS idx_feedback_unthanked
  ON feedback (github_issue_number)
  WHERE status = 'processed' AND thanked_at IS NULL AND github_issue_number IS NOT NULL;

-- ═══════════════════════════════════════════════════
-- CHAT RATE LIMITS
-- ═══════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS chat_rate_limits (
  caller_id    TEXT PRIMARY KEY,
  minute_count INTEGER NOT NULL DEFAULT 0,
  hour_count   INTEGER NOT NULL DEFAULT 0,
  minute_window TIMESTAMPTZ NOT NULL DEFAULT now(),
  hour_window   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ═══════════════════════════════════════════════════
-- RPC FUNCTIONS (used by conviction triage)
-- ═══════════════════════════════════════════════════

-- Find similar feedback by cosine similarity
CREATE OR REPLACE FUNCTION match_feedback(
  query_embedding vector(768),
  similarity_threshold float DEFAULT 0.75,
  match_count int DEFAULT 20
)
RETURNS TABLE (
  id int,
  message text,
  category text,
  priority text,
  ai_summary text,
  player_name text,
  created_at timestamptz,
  similarity float
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT
    f.id,
    f.message,
    f.category,
    f.priority,
    f.ai_summary,
    f.player_name,
    f.created_at,
    1 - (f.embedding <=> query_embedding) AS similarity
  FROM feedback f
  WHERE f.embedding IS NOT NULL
    AND 1 - (f.embedding <=> query_embedding) > similarity_threshold
  ORDER BY f.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;

-- Get centroid embedding for a github issue cluster
CREATE OR REPLACE FUNCTION issue_centroid(
  issue_num int
)
RETURNS vector(768)
LANGUAGE plpgsql
AS $$
DECLARE
  result vector(768);
BEGIN
  SELECT AVG(embedding) INTO result
  FROM feedback
  WHERE github_issue_number = issue_num
    AND embedding IS NOT NULL;
  RETURN result;
END;
$$;

-- ═══════════════════════════════════════════════════
-- GRANTS
-- ═══════════════════════════════════════════════════

GRANT ALL ON players TO service_role;
GRANT EXECUTE ON FUNCTION match_feedback(vector(768), float, int) TO service_role;
GRANT EXECUTE ON FUNCTION issue_centroid(int) TO service_role;
