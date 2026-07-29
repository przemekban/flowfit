import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { LastLoggedSets, WorkoutSessionWithSets, WorkoutWithExercises } from "@/types";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import ResumeRestartModal from "@/components/session/ResumeRestartModal";
import SetRow, { type PendingSetPayload } from "@/components/session/SetRow";

interface SessionLoggerProps {
  workout: WorkoutWithExercises;
  session: WorkoutSessionWithSets;
  lastLoggedSets: LastLoggedSets;
  needsChoice: boolean;
}

function initialOpenCounts(workout: WorkoutWithExercises, session: WorkoutSessionWithSets): Record<string, number> {
  return Object.fromEntries(
    workout.exercises.map((we) => [
      we.exercise_id,
      session.sets.filter((s) => s.exercise_id === we.exercise_id).length + 1,
    ]),
  );
}

export default function SessionLogger({ workout, session, lastLoggedSets, needsChoice }: SessionLoggerProps) {
  const [resolved, setResolved] = useState(!needsChoice);
  const [currentSession, setCurrentSession] = useState(session);
  const [currentLastLoggedSets, setCurrentLastLoggedSets] = useState(lastLoggedSets);
  const [openCounts, setOpenCounts] = useState<Record<string, number>>(() => initialOpenCounts(workout, session));
  const [failedSaves, setFailedSaves] = useState<Set<string>>(new Set());
  const [finishing, setFinishing] = useState(false);
  const pendingRef = useRef<Map<string, PendingSetPayload>>(new Map());

  const sortedExercises = useMemo(
    () => [...workout.exercises].sort((a, b) => a.position - b.position),
    [workout.exercises],
  );

  useEffect(() => {
    function handleBeforeUnload(event: BeforeUnloadEvent) {
      if (pendingRef.current.size === 0) return;

      for (const payload of pendingRef.current.values()) {
        const blob = new Blob([JSON.stringify(payload)], { type: "application/json" });
        navigator.sendBeacon(`/api/sessions/${currentSession.id}/sets`, blob);
      }

      event.preventDefault();
    }

    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
    };
  }, [currentSession.id]);

  const handlePendingChange = useCallback((key: string, payload: PendingSetPayload | null) => {
    if (payload) {
      pendingRef.current.set(key, payload);
    } else {
      pendingRef.current.delete(key);
    }
  }, []);

  function handleSaveFailed(key: string) {
    setFailedSaves((prev) => {
      const next = new Set(prev);
      next.add(key);
      return next;
    });
  }

  function handleRowSaved(exerciseId: string) {
    setOpenCounts((prev) => ({ ...prev, [exerciseId]: (prev[exerciseId] ?? 1) + 1 }));
  }

  function handleResume() {
    setResolved(true);
  }

  function handleRestarted(newSession: WorkoutSessionWithSets, newLastLoggedSets: LastLoggedSets) {
    pendingRef.current.clear();
    setFailedSaves(new Set());
    setCurrentSession(newSession);
    setCurrentLastLoggedSets(newLastLoggedSets);
    setOpenCounts(initialOpenCounts(workout, newSession));
    setResolved(true);
  }

  async function handleFinish() {
    setFinishing(true);
    try {
      const response = await fetch(`/api/sessions/${currentSession.id}/complete`, { method: "POST" });
      if (!response.ok) {
        setFinishing(false);
        return;
      }
      window.location.href = "/history";
    } catch {
      setFinishing(false);
    }
  }

  if (!resolved) {
    return (
      <ResumeRestartModal
        workoutName={workout.name}
        sessionId={currentSession.id}
        startedAt={currentSession.started_at}
        loggedSetCount={currentSession.sets.length}
        onResume={handleResume}
        onRestarted={handleRestarted}
      />
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between rounded-2xl border border-white/10 bg-white/10 p-4">
        <h1 className="text-xl font-semibold text-white">{workout.name}</h1>
        <Button onClick={handleFinish} disabled={finishing}>
          {finishing ? "Finishing…" : "Finish workout"}
        </Button>
      </div>

      {failedSaves.size > 0 && (
        <div className="flex items-center justify-between rounded-lg border border-red-500/30 bg-red-900/30 px-3 py-2 text-sm text-red-300">
          <span>Some sets couldn&apos;t be saved after several attempts. Your entered values are still shown.</span>
          <button
            type="button"
            className="ml-3 shrink-0 underline"
            onClick={() => {
              setFailedSaves(new Set());
            }}
          >
            Dismiss
          </button>
        </div>
      )}

      {sortedExercises.map((we) => {
        const openCount = openCounts[we.exercise_id] ?? 1;
        const existingSets = currentSession.sets.filter((s) => s.exercise_id === we.exercise_id);
        const prefill = currentLastLoggedSets[we.exercise_id];

        return (
          <Card key={we.exercise_id} className="border-white/10 bg-white/10 text-white">
            <CardHeader>
              <CardTitle>{we.exercise.name}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {Array.from({ length: openCount }, (_, index) => {
                const setNumber = index + 1;
                const existing = existingSets.find((s) => s.set_number === setNumber);
                const key = `${we.exercise_id}:${setNumber}`;
                return (
                  <SetRow
                    key={key}
                    sessionId={currentSession.id}
                    exerciseId={we.exercise_id}
                    trackingType={we.exercise.tracking_type}
                    setNumber={setNumber}
                    savedQuantity={existing ? (existing.reps ?? existing.duration_seconds) : null}
                    savedWeightKg={existing ? existing.weight_kg : null}
                    placeholderQuantity={
                      !existing && setNumber === 1 ? (prefill?.reps ?? prefill?.duration_seconds ?? null) : null
                    }
                    placeholderWeightKg={!existing && setNumber === 1 ? (prefill?.weight_kg ?? null) : null}
                    onSaveFailed={() => {
                      handleSaveFailed(key);
                    }}
                    onSaved={() => {
                      handleRowSaved(we.exercise_id);
                    }}
                    onPendingChange={handlePendingChange}
                  />
                );
              })}
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
