import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { waitForScenarioResult, type ScenarioResult } from './api'

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function notFoundResponse(): Response {
  return new Response(JSON.stringify({ message: 'not found' }), { status: 404 })
}

function baseResult(overrides: Partial<ScenarioResult> = {}): ScenarioResult {
  return {
    id: 'scenario-1',
    name: 'Test senaryosu',
    status: 'completed',
    deadlineSeconds: 30600,
    workplace: [32.8597, 39.9334],
    persons: [],
    vehicles: [],
    stops: [],
    routes: [],
    unassignedPersonIds: [],
    ...overrides,
  }
}

describe('waitForScenarioResult', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('returns immediately when the scenario is already completed', async () => {
    const fetchMock = vi.mocked(fetch)
    fetchMock.mockResolvedValueOnce(jsonResponse(baseResult({ status: 'completed' })))

    const result = await waitForScenarioResult('scenario-1')

    expect(result.status).toBe('completed')
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledWith('http://localhost:8080/api/v1/scenarios/scenario-1', { credentials: 'include' })
  })

  it('polls through queued -> running -> completed, reporting each intermediate state', async () => {
    const fetchMock = vi.mocked(fetch)
    fetchMock
      .mockResolvedValueOnce(jsonResponse(baseResult({ status: 'queued' })))
      .mockResolvedValueOnce(jsonResponse(baseResult({ status: 'running' })))
      .mockResolvedValueOnce(jsonResponse(baseResult({ status: 'completed' })))

    const updates: string[] = []
    const promise = waitForScenarioResult('scenario-1', (update) => updates.push(update.status))

    await vi.advanceTimersByTimeAsync(1000)
    await vi.advanceTimersByTimeAsync(1000)
    const result = await promise

    expect(updates).toEqual(['queued', 'running', 'completed'])
    expect(result.status).toBe('completed')
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it('does not treat a failed scenario as still pending', async () => {
    const fetchMock = vi.mocked(fetch)
    fetchMock.mockResolvedValueOnce(
      jsonResponse(baseResult({ status: 'failed', error: 'VROOM hatası' })),
    )

    const result = await waitForScenarioResult('scenario-1')

    expect(result.status).toBe('failed')
    expect(result.error).toBe('VROOM hatası')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('retries on a 404 for the short window before the row is persisted', async () => {
    const fetchMock = vi.mocked(fetch)
    fetchMock
      .mockResolvedValueOnce(notFoundResponse())
      .mockResolvedValueOnce(jsonResponse(baseResult({ status: 'completed' })))

    const promise = waitForScenarioResult('scenario-1')
    await vi.advanceTimersByTimeAsync(1000)
    const result = await promise

    expect(result.status).toBe('completed')
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('times out if the scenario never reaches a terminal state', async () => {
    const fetchMock = vi.mocked(fetch)
    fetchMock.mockImplementation(async () => jsonResponse(baseResult({ status: 'running' })))

    const promise = waitForScenarioResult('scenario-1')
    promise.catch(() => {})
    await vi.advanceTimersByTimeAsync(121000)

    await expect(promise).rejects.toThrow('Senaryo sonucu zaman aşımına uğradı.')
  })
})
