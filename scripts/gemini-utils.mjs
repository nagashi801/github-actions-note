const retryableStatuses = new Set([429, 500, 502, 503, 504]);

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function isRetryableGeminiError(error) {
  const status = Number(error?.status || error?.code || error?.error?.code || 0);
  const message = [
    error?.message,
    error?.cause?.message,
    error?.cause?.code,
    error?.code,
    error,
  ].map(value => String(value || '').toLowerCase()).join(' ');
  return (
    retryableStatuses.has(status) ||
    message.includes('unavailable') ||
    message.includes('high demand') ||
    message.includes('rate limit') ||
    message.includes('temporarily') ||
    message.includes('fetch failed') ||
    message.includes('timeout') ||
    message.includes('und_err') ||
    message.includes('econnreset') ||
    message.includes('etimedout')
  );
}

export async function withGeminiRetry(label, operation, options = {}) {
  const retries = Number(options.retries ?? process.env.GEMINI_RETRIES ?? 5);
  const baseDelayMs = Number(options.baseDelayMs ?? process.env.GEMINI_RETRY_BASE_MS ?? 15000);
  const maxDelayMs = Number(options.maxDelayMs ?? process.env.GEMINI_RETRY_MAX_MS ?? 120000);

  for (let attempt = 0; ; attempt++) {
    try {
      return await operation();
    } catch (error) {
      if (attempt >= retries || !isRetryableGeminiError(error)) {
        throw error;
      }

      const delay = Math.min(maxDelayMs, baseDelayMs * 2 ** attempt);
      const jitter = Math.floor(Math.random() * 3000);
      const waitMs = delay + jitter;
      console.warn(
        `${label} failed with retryable Gemini error (${error?.status || error?.cause?.code || error?.code || 'unknown'}). ` +
        `Retrying in ${Math.round(waitMs / 1000)}s (${attempt + 1}/${retries})...`
      );
      await sleep(waitMs);
    }
  }
}
