-- =============================================================================
-- Enforce reps XOR duration at the database layer
-- =============================================================================
-- save_generated_training_plan grants EXECUTE to all `authenticated` users and
-- only checks auth.uid() + FK integrity; the reps-XOR-duration rule was
-- previously enforced only by the Zod schema in src/lib/validation/plan.ts,
-- so a direct RPC call bypassing that validation could write a row with both
-- (or neither) field set. This CHECK constraint makes the invariant hold
-- regardless of the calling code path.
-- =============================================================================

ALTER TABLE workout_exercises
  ADD CONSTRAINT workout_exercises_tracking_xor CHECK (
    (target_reps IS NOT NULL AND target_duration_seconds IS NULL) OR
    (target_reps IS NULL AND target_duration_seconds IS NOT NULL)
  );
