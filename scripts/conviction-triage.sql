-- Migration: Enable pgvector and add embedding support to feedback table
-- Run this in Supabase SQL Editor BEFORE the first triage run.

-- 1. Enable pgvector extension
CREATE EXTENSION IF NOT EXISTS vector;

-- 2. Add embedding column to feedback table (768 dims for gemini-embedding-001)
ALTER TABLE feedback
  ADD COLUMN IF NOT EXISTS embedding vector(768),
  ADD COLUMN IF NOT EXISTS github_issue_number INT;

-- 3. Index for fast similarity search (ivfflat — good up to ~1M rows)
-- Using cosine distance operator class
CREATE INDEX IF NOT EXISTS idx_feedback_embedding
  ON feedback USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 10);

-- 4. RPC function: find similar feedback by cosine similarity
-- Returns feedback IDs + similarity score above a threshold
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

-- 5. RPC function: get centroid embedding for a github issue cluster
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

GRANT EXECUTE ON FUNCTION match_feedback TO service_role;
GRANT EXECUTE ON FUNCTION issue_centroid TO service_role;
