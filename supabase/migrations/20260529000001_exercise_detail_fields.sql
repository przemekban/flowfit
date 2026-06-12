-- =============================================================================
-- Exercise Detail Fields
-- =============================================================================
-- Adds six nullable content columns to exercises for Polish-language detail
-- data scraped from SmartWorkout. Nullable so the migration is safe to apply
-- to a table that already has rows (Phase 1 seed rows get NULL until Phase 3
-- seed populates them).
-- =============================================================================

ALTER TABLE exercises
  ADD COLUMN description       TEXT,
  ADD COLUMN instructions      TEXT[],
  ADD COLUMN muscles_primary   TEXT[],
  ADD COLUMN muscles_secondary TEXT[],
  ADD COLUMN tips              TEXT[],
  ADD COLUMN common_mistakes   TEXT[];
