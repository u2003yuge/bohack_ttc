export function limit(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value >= 1 && value <= 900_000 ? value : fallback;
}

export function deadline(parent: AbortSignal | undefined, milliseconds: number, message: string) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error(message)), milliseconds);
  timer.unref();
  return {
    signal: parent ? AbortSignal.any([parent, controller.signal]) : controller.signal,
    dispose: () => clearTimeout(timer),
    abort: (reason: unknown) => controller.abort(reason),
  };
}

// Also bound injected adapters and providers that fail to honor AbortSignal.
export async function interruptible<T>(operation: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return operation;
  if (signal.aborted) {
    void operation.catch(() => {});
    signal.throwIfAborted();
  }
  let listener: () => void = () => {};
  const interrupted = new Promise<never>((_resolve, reject) => {
    listener = () => reject(signal.reason ?? new Error("操作已取消。"));
    signal.addEventListener("abort", listener, { once: true });
    if (signal.aborted) listener();
  });
  try { return await Promise.race([operation, interrupted]); }
  finally { signal.removeEventListener("abort", listener); }
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "未知错误";
}
