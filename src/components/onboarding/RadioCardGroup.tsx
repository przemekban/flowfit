import { CircleAlert } from "lucide-react";
import { cn } from "@/lib/utils";

interface Option {
  value: string;
  label: string;
}

interface RadioCardGroupProps {
  name: string;
  legend: string;
  options: readonly Option[];
  value: string;
  onChange: (value: string) => void;
  error?: string;
}

export function RadioCardGroup({ name, legend, options, value, onChange, error }: RadioCardGroupProps) {
  return (
    <fieldset>
      <legend className="mb-2 block text-sm text-blue-100/80">{legend}</legend>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {options.map((option) => {
          const checked = value === option.value;
          return (
            <label
              key={option.value}
              className={cn(
                "cursor-pointer rounded-lg border px-3 py-2 text-center text-sm text-white transition-colors",
                checked ? "border-purple-400 bg-purple-500/30" : "border-white/20 bg-white/10 hover:bg-white/15",
              )}
            >
              <input
                type="radio"
                name={name}
                value={option.value}
                checked={checked}
                onChange={() => {
                  onChange(option.value);
                }}
                className="sr-only"
              />
              {option.label}
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
