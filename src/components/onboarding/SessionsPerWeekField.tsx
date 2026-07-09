import { CircleAlert } from "lucide-react";
import { cn } from "@/lib/utils";
import { SESSIONS_PER_WEEK_MIN, SESSIONS_PER_WEEK_MAX } from "@/lib/onboarding-options";

interface SessionsPerWeekFieldProps {
  value: string;
  onChange: (value: string) => void;
  error?: string;
}

const OPTIONS = Array.from(
  { length: SESSIONS_PER_WEEK_MAX - SESSIONS_PER_WEEK_MIN + 1 },
  (_, i) => SESSIONS_PER_WEEK_MIN + i,
);

export function SessionsPerWeekField({ value, onChange, error }: SessionsPerWeekFieldProps) {
  return (
    <fieldset>
      <legend className="mb-2 block text-sm text-blue-100/80">Sessions per week</legend>
      <div className="flex flex-wrap gap-2">
        {OPTIONS.map((n) => {
          const optionValue = String(n);
          const checked = value === optionValue;
          return (
            <label
              key={n}
              className={cn(
                "flex size-9 cursor-pointer items-center justify-center rounded-full border text-sm text-white transition-colors",
                checked ? "border-purple-400 bg-purple-500/30" : "border-white/20 bg-white/10 hover:bg-white/15",
              )}
            >
              <input
                type="radio"
                name="sessions_per_week"
                value={optionValue}
                checked={checked}
                onChange={() => {
                  onChange(optionValue);
                }}
                className="sr-only"
              />
              {n}
            </label>
          );
        })}
      </div>
      {error ? (
        <p className="mt-1 flex items-center gap-1 text-xs text-red-300">
          <CircleAlert className="size-3" />
          {error}
        </p>
      ) : null}
    </fieldset>
  );
}
