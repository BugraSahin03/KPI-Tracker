// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { waitForHealthyChild } from './wait-for-smoke-health.mjs'

describe('Production-Smoke-Startup', () => {
  it('akzeptiert keine stale Health-Antwort, wenn der gestartete Kandidat während des Fetches stirbt', async () => {
    const child = { exitCode: null as number | null, signalCode: null as NodeJS.Signals | null }
    const fetchImpl = vi.fn(async () => {
      child.exitCode = 1
      return new Response(JSON.stringify({ status: 'ok', sqliteReady: true, schemaVersion: 9 }), {
        status: 200, headers: { 'Content-Type': 'application/json' },
      })
    })
    await expect(waitForHealthyChild({
      child, healthUrl: 'http://127.0.0.1:43179/api/health', diagnostics: () => 'EADDRINUSE',
      startupTimeoutMs: 20_000, pollIntervalMs: 100, requestTimeoutMs: 1_000, fetchImpl,
    })).rejects.toThrow(/Server wurde vorzeitig beendet \(Exit-Code 1\):\nEADDRINUSE/)
    expect(fetchImpl).toHaveBeenCalledOnce()
  })

  it('prüft einen Exit nach Ablauf der monotonen Deadline vor dem Timeout', async () => {
    const child = { exitCode: null as number | null, signalCode: null as NodeJS.Signals | null }
    let now = 0
    await expect(waitForHealthyChild({
      child, healthUrl: 'http://127.0.0.1/api/health', diagnostics: () => 'exit after fetch',
      startupTimeoutMs: 20_000, pollIntervalMs: 100, requestTimeoutMs: 1_000,
      monotonicNow: () => now,
      fetchImpl: async () => { now = 20_000; child.exitCode = 2; throw new Error('connection lost') },
    })).rejects.toThrow(/Server wurde vorzeitig beendet \(Exit-Code 2\):\nexit after fetch/)
  })

  it('akzeptiert stale Health auch bei Signalbeendigung mit null Exit-Code nicht', async () => {
    const child = { exitCode: null as number | null, signalCode: null as NodeJS.Signals | null }
    const fetchImpl = vi.fn(async () => {
      child.signalCode = 'SIGTERM'
      return new Response(JSON.stringify({ status: 'ok', sqliteReady: true, schemaVersion: 9 }), {
        status: 200, headers: { 'Content-Type': 'application/json' },
      })
    })
    await expect(waitForHealthyChild({
      child, healthUrl: 'http://127.0.0.1:43179/api/health', diagnostics: () => 'terminated by supervisor',
      startupTimeoutMs: 20_000, pollIntervalMs: 100, requestTimeoutMs: 1_000, fetchImpl,
    })).rejects.toThrow(/Server wurde vorzeitig beendet \(Signal SIGTERM\):\nterminated by supervisor/)
    expect(fetchImpl).toHaveBeenCalledOnce()
  })
})
