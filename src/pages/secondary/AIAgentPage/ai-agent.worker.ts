const TIMEOUT_MS = 10_000

self.onmessage = (e) => {
  const { code, data } = e.data

  const timer = setTimeout(() => {
    self.postMessage({ error: `Script timed out after ${TIMEOUT_MS / 1000}s` })
    self.close()
  }, TIMEOUT_MS)

  try {
    let fn: (data: unknown) => unknown

    // Try 1: treat as a callable expression (function expr or arrow fn)
    try {
      const candidate = new Function(`return (${code.trim()})`)() as unknown
      if (typeof candidate === 'function') {
        fn = candidate as typeof fn
      } else {
        throw new Error('not a function')
      }
    } catch {
      // Try 2: plain imperative code — expose `data` as a variable, last expression is result
      fn = new Function('data', `${code}\nreturn data;`) as typeof fn
    }

    const result = fn(data)

    // Handle promises
    if (result && typeof (result as any).then === 'function') {
      ;(result as Promise<unknown>)
        .then((r) => { clearTimeout(timer); self.postMessage({ results: r }) })
        .catch((err: any) => { clearTimeout(timer); self.postMessage({ error: String(err?.message ?? err) }) })
    } else {
      clearTimeout(timer)
      self.postMessage({ results: result })
    }
  } catch (error: any) {
    clearTimeout(timer)
    self.postMessage({ error: String(error?.message ?? error) })
  }
}
