-- Migration: Add thanked_at column to feedback table for reporter thank-you tracking.
-- Run this in Supabase SQL Editor.

-- 1. Add thanked_at timestamp to feedback (null = not yet thanked)
ALTER TABLE feedback
  ADD COLUMN IF NOT EXISTS thanked_at TIMESTAMPTZ;

-- 2. Index for efficient lookups of unthanked, processed feedback linked to closed issues
CREATE INDEX IF NOT EXISTS idx_feedback_unthanked
  ON feedback (github_issue_number)
  WHERE status = 'processed' AND thanked_at IS NULL AND github_issue_number IS NOT NULL;
