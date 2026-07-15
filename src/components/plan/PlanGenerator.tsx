import { useCallback, useEffect, useRef, useState } from "react";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";

const PROGRESS_MESSAGES = ["Analyzing your profile…", "Selecting exercises…", "Finalizing your plan…"];
const MESSAGE_INTERVAL_MS = 2500;

export default function PlanGenerator() {
  const [status, setStatus] = useState<"loading" | "error">("loading");
  const [messageIndex, setMessageIndex] = useState(0);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const hasFiredRef = useRef(false);
  const abortControllerRef = useRef<AbortController | null>(null);
  const intervalIdRef = useRef<number | null>(null);

  const startMessageCycle = useCallback(() => {
    intervalIdRef.current = window.setInterval(() => {
      setMessageIndex((i) => (i + 1) % PROGRESS_MESSAGES.length);
    }, MESSAGE_INTERVAL_MS);
  }, []);

  const stopMessageCycle = useCallback(() => {
    if (intervalIdRef.current !== null) {
      window.clearInterval(intervalIdRef.current);
      intervalIdRef.current = null;
    }
  }, []);

  const fireGeneration = useCallback(() => {
    if (hasFiredRef.current) return;
    hasFiredRef.current = true;
    setStatus("loading");
    setMessageIndex(0);
    startMessageCycle();

    const controller = new AbortController();
    abortControllerRef.current = controller;

    fetch("/api/plan", { method: "POST", signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) {
          const body = (await response.json().catch(() => null)) as { message?: string } | null;
          stopMessageCycle();
          setErrorMessage(body?.message ?? "Something went wrong while generating your plan.");
          setStatus("error");
          return;
        }

        window.location.reload();
      })
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === "AbortError") return;
        stopMessageCycle();
        setErrorMessage("Something went wrong while generating your plan.");
        setStatus("error");
      });
  }, [startMessageCycle, stopMessageCycle]);

  useEffect(() => {
    fireGeneration();

    return () => {
      abortControllerRef.current?.abort();
      stopMessageCycle();
    };
  }, [fireGeneration, stopMessageCycle]);

  function handleRetry() {
    hasFiredRef.current = false;
    setErrorMessage(null);
    fireGeneration();
  }

  if (status === "error") {
    return (
      <div className="w-full max-w-sm rounded-2xl border border-red-500/30 bg-red-900/20 p-6 text-center text-white">
        <p className="text-sm text-red-300">{errorMessage}</p>
        <Button onClick={handleRetry} className="mt-4 w-full">
          <RefreshCw className="size-4" />
          Try again
        </Button>
      </div>
    );
  }

  return (
    <div className="w-full max-w-sm rounded-2xl border border-white/10 bg-white/10 p-6 text-center text-white">
      <div className="mx-auto size-8 animate-spin rounded-full border-2 border-white/30 border-t-white" />
      <p className="mt-4 text-sm text-blue-100/80">{PROGRESS_MESSAGES[messageIndex]}</p>
    </div>
  );
}
