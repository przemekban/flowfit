import { useState } from "react";
import { ClipboardList } from "lucide-react";
import { RadioCardGroup } from "@/components/onboarding/RadioCardGroup";
import { EquipmentField } from "@/components/onboarding/EquipmentField";
import { SessionsPerWeekField } from "@/components/onboarding/SessionsPerWeekField";
import { SubmitButton } from "@/components/auth/SubmitButton";
import { ServerError } from "@/components/auth/ServerError";
import { TRAINING_GOALS, EXPERIENCE_LEVELS, PREFERRED_STYLES } from "@/lib/onboarding-options";

interface Props {
  serverError?: string | null;
}

interface Errors {
  training_goal?: string;
  experience_level?: string;
  equipment?: string;
  preferred_style?: string;
  sessions_per_week?: string;
}

export default function OnboardingForm({ serverError }: Props) {
  const [trainingGoal, setTrainingGoal] = useState("");
  const [experienceLevel, setExperienceLevel] = useState("");
  const [equipment, setEquipment] = useState<string[]>([]);
  const [preferredStyle, setPreferredStyle] = useState("");
  const [sessionsPerWeek, setSessionsPerWeek] = useState("");
  const [errors, setErrors] = useState<Errors>({});

  function validate() {
    const next: Errors = {};

    if (!trainingGoal) next.training_goal = "Please choose a training goal";
    if (!experienceLevel) next.experience_level = "Please choose your experience level";
    if (equipment.length === 0) next.equipment = "Select at least one piece of equipment";
    if (!preferredStyle) next.preferred_style = "Please choose a preferred style";
    if (!sessionsPerWeek) next.sessions_per_week = "Please choose how many sessions per week";

    setErrors(next);
    return Object.keys(next).length === 0;
  }

  function handleSubmit(e: React.SubmitEvent<HTMLFormElement>) {
    if (!validate()) {
      e.preventDefault();
    }
  }

  return (
    <form method="POST" action="/api/profile" className="space-y-5" onSubmit={handleSubmit} noValidate>
      <RadioCardGroup
        name="training_goal"
        legend="Training goal"
        options={TRAINING_GOALS}
        value={trainingGoal}
        onChange={setTrainingGoal}
        error={errors.training_goal}
      />

      <RadioCardGroup
        name="experience_level"
        legend="Experience level"
        options={EXPERIENCE_LEVELS}
        value={experienceLevel}
        onChange={setExperienceLevel}
        error={errors.experience_level}
      />

      <EquipmentField value={equipment} onChange={setEquipment} error={errors.equipment} />

      <RadioCardGroup
        name="preferred_style"
        legend="Preferred style"
        options={PREFERRED_STYLES}
        value={preferredStyle}
        onChange={setPreferredStyle}
        error={errors.preferred_style}
      />

      <SessionsPerWeekField value={sessionsPerWeek} onChange={setSessionsPerWeek} error={errors.sessions_per_week} />

      <ServerError message={serverError} />

      <SubmitButton pendingText="Saving..." icon={<ClipboardList className="size-4" />}>
        Save and continue
      </SubmitButton>
    </form>
  );
}
