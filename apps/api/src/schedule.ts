const MINUTE_MS = 60_000;

/** Runs the task at the start of every minute until `stop` is called. The task must not throw. */
export function everyMinute(task: () => Promise<void>): { stop: () => void } {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const arm = (): void => {
    timer = setTimeout(
      () => {
        arm();
        void task();
      },
      MINUTE_MS - (Date.now() % MINUTE_MS),
    );
  };
  arm();
  return { stop: () => clearTimeout(timer) };
}
