import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import type { LastLoggedSets, WorkoutSessionWithSets } from "@/types";

interface ResumeRestartModalProps {
  workoutName: string;
  sessionId: string;
  startedAt: string;
  loggedSetCount: number;
  onResume: () => void;
  onRestarted: (session: WorkoutSessionWithSets, lastLoggedSets: LastLoggedSets) => void;
}

export default function ResumeRestartModal({
  workoutName,
  sessionId,
  startedAt,
  loggedSetCount,
  onResume,
  onRestarted,
}: ResumeRestartModalProps) {
  const [restarting, setRestarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleStartOver() {
    setRestarting(true);
    setError(null);
    try {
      const response = await fetch(`/api/sessions/${sessionId}/restart`, { method: "POST" });
      if (!response.ok) {
        setError("Couldn't start over. Please try again.");
        setRestarting(false);
        return;
      }
      const data = (await response.json()) as { session: WorkoutSessionWithSets; lastLoggedSets: LastLoggedSets };
      onRestarted(data.session, data.lastLoggedSets);
    } catch {
      setError("Couldn't start over. Please try again.");
      setRestarting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <Card className="w-full max-w-sm border-white/10 bg-slate-900 text-white">
        <CardHeader>
          <CardTitle>Unfinished session</CardTitle>
          <CardDescription className="text-blue-100/70">
            You already have an active session for <span className="font-medium text-white">{workoutName}</span>,
            started {new Date(startedAt).toLocaleString()} with {loggedSetCount} set{loggedSetCount === 1 ? "" : "s"}{" "}
            logged.
          </CardDescription>
        </CardHeader>
        {error && (
          <CardContent>
            <p className="text-sm text-red-300">{error}</p>
          </CardContent>
        )}
        <CardFooter className="flex gap-3">
          <Button className="flex-1" onClick={onResume} disabled={restarting}>
            Resume
          </Button>
          <Button className="flex-1" variant="outline" onClick={handleStartOver} disabled={restarting}>
            {restarting ? "Starting over…" : "Start over"}
          </Button>
        </CardFooter>
      </Card>
    </div>
  );
}
