import { useState } from "react";
import type { UserProfile } from "@/types";
import { TRAINING_GOALS, EXPERIENCE_LEVELS, PREFERRED_STYLES, EQUIPMENT_OPTIONS } from "@/lib/onboarding-options";
import { ServerError } from "@/components/auth/ServerError";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

interface ProfileSummaryProps {
  profile: UserProfile;
  error?: string | null;
}

function labelFor(options: readonly { value: string; label: string }[], value: string) {
  return options.find((o) => o.value === value)?.label ?? value;
}

export function ProfileSummary({ profile, error }: ProfileSummaryProps) {
  const [isResetOpen, setIsResetOpen] = useState(false);

  const rows: { label: string; value: string }[] = [
    { label: "Training goal", value: labelFor(TRAINING_GOALS, profile.training_goal) },
    { label: "Experience level", value: labelFor(EXPERIENCE_LEVELS, profile.experience_level) },
    { label: "Equipment", value: profile.equipment.map((v) => labelFor(EQUIPMENT_OPTIONS, v)).join(", ") },
    { label: "Preferred style", value: labelFor(PREFERRED_STYLES, profile.preferred_style) },
    { label: "Sessions per week", value: String(profile.sessions_per_week) },
  ];

  return (
    <div className="space-y-4">
      <dl className="space-y-3">
        {rows.map((row) => (
          <div key={row.label} className="rounded-lg border border-white/10 bg-white/5 px-3 py-2">
            <dt className="text-xs text-blue-100/60">{row.label}</dt>
            <dd className="mt-0.5 text-sm text-white">{row.value}</dd>
          </div>
        ))}
      </dl>

      <ServerError message={error} />

      <a
        href="/dashboard"
        className="block w-full rounded-lg bg-purple-600 px-4 py-2 text-center font-medium text-white transition-colors hover:bg-purple-500"
      >
        Back to dashboard
      </a>

      <Dialog open={isResetOpen} onOpenChange={setIsResetOpen}>
        <DialogTrigger asChild>
          <Button variant="destructive" className={cn("w-full")}>
            Reset profile
          </Button>
        </DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reset your training profile?</DialogTitle>
            <DialogDescription>
              This deletes your saved survey answers and takes you back to a blank onboarding form. You&apos;ll need to
              retake the survey to generate a new plan. This can&apos;t be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setIsResetOpen(false);
              }}
            >
              Cancel
            </Button>
            <form method="POST" action="/api/profile/reset">
              <Button type="submit" variant="destructive">
                Reset profile
              </Button>
            </form>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
