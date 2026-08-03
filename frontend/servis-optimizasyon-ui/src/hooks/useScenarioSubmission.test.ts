import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useScenarioSubmission } from './useScenarioSubmission'
import type { ScenarioInput } from '../lib/api'

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

const sampleInput: ScenarioInput = {
  name: 'Test senaryosu',
  direction: 'morning_inbound',
  workplace: [32.85, 39.92],
  arrivalDeadline: '08:30:00',
  persons: [{ id: 'person-001', location: [32.86, 39.93] }],
  vehicles: [{ id: 'vehicle-001', capacity: 16, start: [32.85, 39.92] }],
}

describe('useScenarioSubmission', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('starts idle', () => {
    const { result } = renderHook(() => useScenarioSubmission())
    expect(result.current.scenarioState).toBe('idle')
    expect(result.current.scenarioResult).toBeNull()
  })

  it('moves through submitting -> waiting -> completed on a successful flow', async () => {
    const fetchMock = vi.mocked(fetch)
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ id: 'scenario-1', status: 'queued' }, 202))
      .mockResolvedValueOnce(
        jsonResponse({
          id: 'scenario-1',
          name: sampleInput.name,
          status: 'completed',
          deadlineSeconds: 30600,
          stops: [],
          routes: [],
          unassignedPersonIds: [],
        }),
      )

    const { result } = renderHook(() => useScenarioSubmission())

    act(() => {
      void result.current.submitScenario(sampleInput)
    })

    await waitFor(() => expect(result.current.scenarioState).toBe('completed'))
    expect(result.current.scenarioResult?.status).toBe('completed')
    expect(result.current.errorMessage).toBe('')
  })

  it('surfaces the backend error message when the scenario fails', async () => {
    const fetchMock = vi.mocked(fetch)
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ id: 'scenario-2', status: 'queued' }, 202))
      .mockResolvedValueOnce(
        jsonResponse({
          id: 'scenario-2',
          name: sampleInput.name,
          status: 'failed',
          deadlineSeconds: 30600,
          stops: [],
          routes: [],
          unassignedPersonIds: [],
          error: 'VROOM hatası: no solution found',
        }),
      )

    const { result } = renderHook(() => useScenarioSubmission())

    act(() => {
      void result.current.submitScenario(sampleInput)
    })

    await waitFor(() => expect(result.current.scenarioState).toBe('failed'))
    expect(result.current.errorMessage).toBe('VROOM hatası: no solution found')
  })

  it('surfaces a network error from the initial POST as a failed state', async () => {
    const fetchMock = vi.mocked(fetch)
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'))

    const { result } = renderHook(() => useScenarioSubmission())

    act(() => {
      void result.current.submitScenario(sampleInput)
    })

    await waitFor(() => expect(result.current.scenarioState).toBe('failed'))
    expect(result.current.errorMessage).toBe('Failed to fetch')
  })
})
