/**
 * A concurrency limiter for parallel async operations.
 * Limits the number of concurrent promises to prevent overwhelming APIs.
 */
export function createConcurrencyLimiter(maxConcurrent: number) {
  let activeCount = 0
  const queue: (() => void)[] = []

  function next(): void {
    if (queue.length > 0 && activeCount < maxConcurrent) {
      activeCount++
      const resolve = queue.shift()
      resolve?.()
    }
  }

  async function acquire(): Promise<void> {
    if (activeCount < maxConcurrent) {
      activeCount++
      return
    }

    return new Promise<void>((resolve) => {
      queue.push(resolve)
    })
  }

  function release(): void {
    activeCount--
    next()
  }

  /** Run a function with concurrency limiting. */
  async function run<T>(fn: () => Promise<T>): Promise<T> {
    await acquire()
    try {
      return await fn()
    } finally {
      release()
    }
  }

  /** Map over items with concurrency limiting. */
  async function map<T, R>(items: readonly T[], fn: (item: T) => Promise<R>): Promise<R[]> {
    return Promise.all(items.map((item) => run(() => fn(item))))
  }

  return { run, map }
}
