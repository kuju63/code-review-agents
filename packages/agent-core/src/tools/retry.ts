/** Configuration for {@link withRetry}. */
export interface RetryOptions {
  /** Maximum number of attempts, including the first (non-retry) call. */
  attempts: number;
  /** Base delay in milliseconds for the exponential backoff. */
  baseDelayMs: number;
  /** Decides whether a failure should be retried. Defaults to retrying every error. */
  shouldRetry?: (error: unknown) => boolean;
  /** Injectable sleep, so tests never wait on real timers. */
  sleep?: (ms: number) => Promise<void>;
  /** Injectable source of randomness for the jitter, defaults to `Math.random`. */
  random?: () => number;
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Retries `fn` with exponential backoff and full jitter, mirroring `tenacity`'s
 * `wait_random_exponential`: the delay before retry attempt `i` (0-indexed) is
 * drawn uniformly from `[0, baseDelayMs * 2^i]`.
 */
export async function withRetry<T>(fn: () => Promise<T>, options: RetryOptions): Promise<T> {
  const {
    attempts,
    baseDelayMs,
    shouldRetry = () => true,
    sleep = defaultSleep,
    random = Math.random,
  } = options;

  for (let attemptIndex = 0; ; attemptIndex++) {
    try {
      return await fn();
    } catch (error) {
      const isLastAttempt = attemptIndex >= attempts - 1;
      if (isLastAttempt || !shouldRetry(error)) {
        throw error;
      }
      const maxDelay = baseDelayMs * 2 ** attemptIndex;
      await sleep(random() * maxDelay);
    }
  }
}
