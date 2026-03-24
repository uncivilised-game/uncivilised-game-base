-- Migration: Add player gating columns for 1,000-player cap
-- Run this in Supabase SQL Editor BEFORE deploying the new code.

-- New columns on players table
ALTER TABLE players
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'waitlisted'
    CHECK (status IN ('active', 'waitlisted', 'suspended')),
  ADD COLUMN IF NOT EXISTS access_token UUID DEFAULT gen_random_uuid(),
  ADD COLUMN IF NOT EXISTS email_verified BOOLEAN NOT NULL DEFAULT false;

-- Index for fast token lookups (email verification links)
CREATE INDEX IF NOT EXISTS idx_players_access_token ON players (access_token);

-- Index for counting active players (spots remaining)
CREATE INDEX IF NOT EXISTS idx_players_status ON players (status);

-- Backfill: mark ALL existing players as active + verified
-- (they registered before the gate existed, so they earned it)
UPDATE players SET status = 'active', email_verified = true
  WHERE status = 'waitlisted';

-- Grant service_role access (matches existing RLS pattern)
GRANT ALL ON players TO service_role;
