ALTER TABLE exercises
  ADD COLUMN description       TEXT,
  ADD COLUMN instructions      TEXT[],
  ADD COLUMN muscles_primary   TEXT[],
  ADD COLUMN muscles_secondary TEXT[],
  ADD COLUMN tips              TEXT[],
  ADD COLUMN common_mistakes   TEXT[];
