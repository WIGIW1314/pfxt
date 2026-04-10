import { onErrorCaptured, ref } from "vue";

export type RecoverableError = {
  error: Error;
  source: string;
  retryCount: number;
};

export function useErrorBoundary(section?: string) {
  const caughtError = ref<Error | null>(null);
  const retryCount = ref(0);
  const isRecovering = ref(false);

  onErrorCaptured((err, instance, info) => {
    const source = section || info || "unknown"; void source; // available for future logging

    // Skip noisy errors
    const isNoise =
      info?.includes("nextTick") ||
      info?.includes("transition") ||
      info?.includes("keep-alive") ||
      (instance == null && (info?.includes("mounted") || info?.includes("unmounted")));

    if (isNoise) return false;

    caughtError.value = err instanceof Error ? err : new Error(String(err));
    retryCount.value += 1;
    isRecovering.value = false;

    console.error(`[ErrorBoundary${section ? ` (${section})` : ""}]`, info, err);
    return false; // Prevent re-throw — we handle it gracefully
  });

  function retry() {
    caughtError.value = null;
    isRecovering.value = true;
  }

  function clearError() {
    caughtError.value = null;
    isRecovering.value = false;
  }

  return {
    caughtError,
    retryCount,
    isRecovering,
    retry,
    clearError,
  };
}
