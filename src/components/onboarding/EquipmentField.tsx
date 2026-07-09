import { CircleAlert } from "lucide-react";
import { cn } from "@/lib/utils";
import { EQUIPMENT_OPTIONS } from "@/lib/onboarding-options";

interface EquipmentFieldProps {
  value: string[];
  onChange: (value: string[]) => void;
  error?: string;
}

export function EquipmentField({ value, onChange, error }: EquipmentFieldProps) {
  function toggle(optionValue: string) {
    if (value.includes(optionValue)) {
      onChange(value.filter((v) => v !== optionValue));
    } else {
      onChange([...value, optionValue]);
    }
  }

  return (
    <fieldset>
      <legend className="mb-2 block text-sm text-blue-100/80">Equipment</legend>
      <div className="flex flex-wrap gap-2">
        {EQUIPMENT_OPTIONS.map((option) => {
          const checked = value.includes(option.value);
          return (
            <label
              key={option.value}
              className={cn(
                "cursor-pointer rounded-full border px-3 py-1.5 text-sm text-white transition-colors",
                checked ? "border-purple-400 bg-purple-500/30" : "border-white/20 bg-white/10 hover:bg-white/15",
              )}
            >
              <input
                type="checkbox"
                name="equipment"
                value={option.value}
                checked={checked}
                onChange={() => {
                  toggle(option.value);
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
