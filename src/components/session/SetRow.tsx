import { useCallback, useEffect, useRef, useState } from "react";
import type { ChangeEvent } from "react";
import type { TrackingType } from "@/types";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const DEBOUNCE_MS = 600;
const MAX_RETRIES = 3;
const RETRY_BASE_DELAY_MS = 500;

export interface PendingSetPayload {
  exercise_id: string;
  set_number: number;
  weight_kg: number;
  reps?: number;
  duration_seconds?: number;
}

interface SetRowProps {
  sessionId: string;
  exerciseId: string;
  trackingType: TrackingType;
  setNumber: number;
  initialQuantity: number | null;
  initialWeightKg: number | null;
  initialHasSaved: boolean;
  onSaveFailed: () => void;
  onSaved: () => void;
  onPendingChange: (key: string, payload: PendingSetPayload | null) => void;
}

export default function SetRow({
  sessionId,
  exerciseId,
  trackingType,
  setNumber,
  initialQuantity,
  initialWeightKg,
  initialHasSaved,
  onSaveFailed,
  onSaved,
  onPendingChange,
}: SetRowProps) {
  const [quantity, setQuantity] = useState(initialQuantity !== null ? String(initialQuantity) : "");
  const [weight, setWeight] = useState(initialWeightKg !== null ? String(initialWeightKg) : "");
  const hasSavedRef = useRef(initialHasSaved);
  const hasFiredOnSavedRef = useRef(initialHasSaved);
  const debounceRef = useRef<number | null>(null);
  const requestIdRef = useRef(0);
  const rowKey = `${exerciseId}:${setNumber}`;

  const clearPending = useCallback(() => {
    onPendingChange(rowKey, null);
  }, [onPendingChange, rowKey]);

  useEffect(
    () => () => {
      if (debounceRef.current !== null) {
        window.clearTimeout(debounceRef.current);
      }
      clearPending();
    },
    [clearPending],
  );

  function buildPayload(quantityValue: number, weightValue: number): PendingSetPayload {
    const base = { exercise_id: exerciseId, set_number: setNumber, weight_kg: weightValue };
    return trackingType === "reps" ? { ...base, reps: quantityValue } : { ...base, duration_seconds: quantityValue };
  }

  async function persist(payload: PendingSetPayload, attempt: number): Promise<void> {
    try {
      const response = await fetch(`/api/sessions/${sessionId}/sets`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!response.ok) {
        throw new Error(`Save failed with status ${response.status}`);
      }
      hasSavedRef.current = true;
      if (!hasFiredOnSavedRef.current) {
        hasFiredOnSavedRef.current = true;
        onSaved();
      }
      clearPending();
    } catch {
      if (attempt < MAX_RETRIES) {
        const delay = RETRY_BASE_DELAY_MS * 2 ** attempt;
        await new Promise((resolve) => window.setTimeout(resolve, delay));
        await persist(payload, attempt + 1);
        return;
      }
      clearPending();
      onSaveFailed();
    }
  }

  async function deletePersisted() {
    hasSavedRef.current = false;
    try {
      await fetch(`/api/sessions/${sessionId}/sets`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ exercise_id: exerciseId, set_number: setNumber }),
      });
    } catch {
      // best-effort; the row is already visibly cleared client-side
    }
  }

  function scheduleSave(nextQuantity: string, nextWeight: string) {
    if (debounceRef.current !== null) {
      window.clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }

    const quantityValue = Number(nextQuantity);
    const weightValue = Number(nextWeight);
    const isValid =
      nextQuantity !== "" &&
      Number.isInteger(quantityValue) &&
      quantityValue > 0 &&
      nextWeight !== "" &&
      Number.isFinite(weightValue) &&
      weightValue >= 0;

    if (!isValid) {
      clearPending();
      if (hasSavedRef.current) {
        void deletePersisted();
      }
      return;
    }

    const payload = buildPayload(quantityValue, weightValue);
    onPendingChange(rowKey, payload);
    const requestId = ++requestIdRef.current;
    debounceRef.current = window.setTimeout(() => {
      debounceRef.current = null;
      if (requestId !== requestIdRef.current) return;
      void persist(payload, 0);
    }, DEBOUNCE_MS);
  }

  function handleQuantityChange(event: ChangeEvent<HTMLInputElement>) {
    const value = event.target.value;
    setQuantity(value);
    scheduleSave(value, weight);
  }

  function handleWeightChange(event: ChangeEvent<HTMLInputElement>) {
    const value = event.target.value;
    setWeight(value);
    scheduleSave(quantity, value);
  }

  return (
    <div className="grid grid-cols-[1fr_1fr_auto] items-end gap-3">
      <div>
        <Label htmlFor={`${rowKey}-quantity`} className="text-blue-100/70">
          Set {setNumber} · {trackingType === "reps" ? "Reps" : "Duration (s)"}
        </Label>
        <Input
          id={`${rowKey}-quantity`}
          type="number"
          inputMode="numeric"
          min={1}
          value={quantity}
          onChange={handleQuantityChange}
        />
      </div>
      <div>
        <Label htmlFor={`${rowKey}-weight`} className="text-blue-100/70">
          Weight (kg)
        </Label>
        <Input
          id={`${rowKey}-weight`}
          type="number"
          inputMode="decimal"
          min={0}
          step="0.5"
          value={weight}
          onChange={handleWeightChange}
        />
      </div>
    </div>
  );
}
