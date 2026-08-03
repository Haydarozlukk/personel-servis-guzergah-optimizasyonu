import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createScenario, waitForScenarioResult, type ScenarioInput, type ScenarioResult } from './api'

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function notFoundResponse(): Response {
  return new Response(JSON.stringify({ message: 'not found' }), { status: 404 })
}

const sampleInput: ScenarioInput = {
  name: 'Test senaryosu',
  direction: 'morning_inbound',
  workplace: [32.85, 39.92],
  arrivalDeadline: '08:30:00',
  persons: [{ id: 'person-001', location: [32.86, 39.93] }],
  vehicles: [{ id: 'vehicle-001', capacity: 16, start: [32.85, 39.92] }],
}

function baseResult(overrides: Partial<ScenarioResult> = {}): ScenarioResult {
  return {
    id: 'scenario-1',
    name: 'Test senaryosu',
    status: 'completed',
    deadlineSeconds: 30600,
    stops: [],
    routes: [],
    unassignedPersonIds: [],
    ...overrides,
  }
}

describe('createScenario', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('posts to /api/v1/scenarios with the given input and returns the parsed body', async () => {
    const fetchMock = vi.mocked(fetch)
    fetchMock.mockResolvedValueOnce(jsonResponse({ id: 'abc-123', status: 'queued' }, 202))

    const result = await createScenario(sampleInput)

    expect(result).toEqual({ id: 'abc-123', status: 'queued' })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, options] = fetchMock.mock.calls[0]
    expect(url).toBe('http://localhost:8080/api/v1/scenarios')
    expect(options).toMatchObject({
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    })
    expect(JSON.parse(options!.body as string)).toEqual(sampleInput)
  })

  it('throws a message built from the validation errors on a 400 response', async () => {
    const fetchMock = vi.mocked(fetch)
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ errors: { vehicles: ['En az bir araç girilmelidir.'] } }, 400),
    )

    await expect(createScenario(sampleInput)).rejects.toThrow('En az bir araç girilmelidir.')
  })

  it('falls back to a status-based message when the error response has no JSON body', async () => {
    const fetchMock = vi.mocked(fetch)
    fetchMock.mockResolvedValueOnce(new Response('', { status: 500 }))

    await expect(createScenario(sampleInput)).rejects.toThrow('İstek başarısız oldu (500).')
  })
})

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
    expect(fetchMock).toHaveBeenCalledWith('http://localhost:8080/api/v1/scenarios/scenario-1')
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
