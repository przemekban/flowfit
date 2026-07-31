---
change_id: fix-plan-db-error-misclassification
title: Fix POST /api/plan misclassifying DB errors from getCandidateExercises as ai_error
status: implemented
created: 2026-07-31
updated: 2026-07-31
archived_at: null
---

## Notes

Fix POST /api/plan misclassifying database errors from getCandidateExercises as ai_error/502 instead of db_error/500
