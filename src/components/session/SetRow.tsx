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
  /** Already-persisted value for this row (resumed/just-saved set). Rendered as the actual input value. */
  savedQuantity: number | null;
  savedWeightKg: number | null;
  /** Suggested last-known value for a row that has never been saved. Rendered as a placeholder hint only. */
  placeholderQuantity: number | null;
  placeholderWeightKg: number | null;
  onSaveFailed: () => void;
  onSaved: () => void;
  onPendingChange: (key: string, payload: PendingSetPayload | null) => void;
}

export default function SetRow({
  sessionId,
  exerciseId,
  trackingType,
  setNumber,
  savedQuantity,
  savedWeightKg,
  placeholderQuantity,
  placeholderWeightKg,
  onSaveFailed,
  onSaved,
  onPendingChange,
}: SetRowProps) {
  const [quantity, setQuantity] = useState(savedQuantity !== null ? String(savedQuantity) : "");
  const [weight, setWeight] = useState(savedWeightKg !== null ? String(savedWeightKg) : "");
  const hasSavedRef = useRef(savedQuantity !== null);
  const hasFiredOnSavedRef = useRef(savedQuantity !== null);
  const debounceRef = useRef<number | null>(null);
  const requestIdRef = useRef(0);
  const opQueueRef = useRef<Promise<void>>(Promise.resolve());
  const isMountedRef = useRef(true);
  const rowKey = `${exerciseId}:${setNumber}`;

  function enqueue(op: () => Promise<void>) {
    opQueueRef.current = opQueueRef.current.then(op);
  }

  const clearPending = useCallback(() => {
    onPendingChange(rowKey, null);
  }, [onPendingChange, rowKey]);

  useEffect(
    () => () => {
      isMountedRef.current = false;
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
      if (isMountedRef.current && !hasFiredOnSavedRef.current) {
        hasFiredOnSavedRef.current = true;
        onSaved();
      }
      if (isMountedRef.current) clearPending();
    } catch {
      if (attempt < MAX_RETRIES) {
        const delay = RETRY_BASE_DELAY_MS * 2 ** attempt;
        await new Promise((resolve) => window.setTimeout(resolve, delay));
        if (!isMountedRef.current) return;
        await persist(payload, attempt + 1);
        return;
      }
      if (isMountedRef.current) {
        clearPending();
        onSaveFailed();
      }
    }
  }

  async function deletePersisted() {
    hasSavedRef.current = false;
    try {
      // keepalive lets this request finish even if the tab is being closed
      // (e.g. cleared right before navigate-away), since it isn't covered
      // by the beforeunload/sendBeacon fallback (sendBeacon only does POST).
      await fetch(`/api/sessions/${sessionId}/sets`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ exercise_id: exerciseId, set_number: setNumber }),
        keepalive: true,
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
        enqueue(() => deletePersisted());
      }
      return;
    }

    const payload = buildPayload(quantityValue, weightValue);
    onPendingChange(rowKey, payload);
    const requestId = ++requestIdRef.current;
    debounceRef.current = window.setTimeout(() => {
      debounceRef.current = null;
      if (requestId !== requestIdRef.current) return;
      enqueue(() => persist(payload, 0));
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
          placeholder={placeholderQuantity !== null ? String(placeholderQuantity) : undefined}
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
          placeholder={placeholderWeightKg !== null ? String(placeholderWeightKg) : undefined}
          onChange={handleWeightChange}
        />
      </div>
    </div>
  );
}
