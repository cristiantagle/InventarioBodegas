export async function withRetry<T>(
  task: () => Promise<T>,
  retries = 3,
  delayMs = 350,
): Promise<T> {
  let attempt = 0
  let lastError: unknown

  while (attempt <= retries) {
    try {
      return await task()
    } catch (error) {
      lastError = error
      if (attempt === retries) {
        break
      }

      const jitter = Math.floor(Math.random() * 150)
      await new Promise((resolve) => setTimeout(resolve, delayMs * 2 ** attempt + jitter))
      attempt += 1
    }
  }

  throw lastError
}
