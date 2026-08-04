import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { addPersonsAndReoptimize, waitForScenarioResult, type ScenarioResult } from './api'

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
    vehicles: [],
    stops: [],
    routes: [],
    unassignedPersonIds: [],
    ...overrides,
  }
}

describe('addPersonsAndReoptimize', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('posts the new persons to the scenario and returns the parsed body', async () => {
    const fetchMock = vi.mocked(fetch)
    fetchMock.mockResolvedValueOnce(jsonResponse({ id: 'scenario-1', status: 'queued' }, 202))

    const persons: Parameters<typeof addPersonsAndReoptimize>[1] = [
      { firstName: 'Ada', lastName: 'Lovelace', location: [32.86, 39.93] },
    ]
    const result = await addPersonsAndReoptimize('scenario-1', persons)

    expect(result).toEqual({ id: 'scenario-1', status: 'queued' })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, options] = fetchMock.mock.calls[0]
    expect(url).toBe('http://localhost:8080/api/v1/scenarios/scenario-1/persons')
    expect(options).toMatchObject({
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    })
    expect(JSON.parse(options!.body as string)).toEqual({ persons })
  })

  it('throws a message built from the validation errors on a 400 response', async () => {
    const fetchMock = vi.mocked(fetch)
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ errors: { persons: ['En az bir personel girilmelidir.'] } }, 400),
    )

    await expect(addPersonsAndReoptimize('scenario-1', [])).rejects.toThrow(
      'En az bir personel girilmelidir.',
    )
  })

  it('falls back to a status-based message when the error response has no JSON body', async () => {
    const fetchMock = vi.mocked(fetch)
    fetchMock.mockResolvedValueOnce(new Response('', { status: 500 }))

    await expect(addPersonsAndReoptimize('scenario-1', [])).rejects.toThrow('İstek başarısız oldu (500).')
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
