export async function waitForHealthyChild({
  child,
  healthUrl,
  diagnostics,
  startupTimeoutMs,
  pollIntervalMs,
  requestTimeoutMs,
  fetchImpl = fetch,
  monotonicNow = () => performance.now(),
  pause = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
  settle = () => new Promise((resolve) => setImmediate(resolve)),
}) {
  const assertChildRunning = () => {
    if (child.exitCode !== null || child.signalCode !== null) {
      const termination = child.signalCode !== null ? `Signal ${child.signalCode}` : `Exit-Code ${child.exitCode}`
      throw new Error(`Server wurde vorzeitig beendet (${termination}):\n${diagnostics()}`)
    }
  }
  const deadline = monotonicNow() + startupTimeoutMs
  while (monotonicNow() < deadline) {
    assertChildRunning()
    const remaining = deadline - monotonicNow()
    let response
    try {
      response = await fetchImpl(healthUrl, {
        signal: AbortSignal.timeout(Math.max(1, Math.min(requestTimeoutMs, Math.ceil(remaining)))),
      })
    } catch { /* startup */ }
    assertChildRunning()
    if (response?.ok) {
      let health
      try { health = await response.json() } catch { /* incomplete startup response */ }
      assertChildRunning()
      if (health !== undefined) {
        // Give a just-exited candidate one event-loop turn to publish exitCode.
        await settle()
        assertChildRunning()
        return health
      }
    }
    const wait = Math.min(pollIntervalMs, Math.max(0, deadline - monotonicNow()))
    if (wait > 0) await pause(wait)
  }
  assertChildRunning()
  throw new Error(`Healthcheck-Timeout:\n${diagnostics()}`)
}
