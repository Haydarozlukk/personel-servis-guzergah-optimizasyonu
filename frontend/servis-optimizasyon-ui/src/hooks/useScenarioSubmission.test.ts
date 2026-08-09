import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useScenarioSubmission } from './useScenarioSubmission'
import type { ExcelImportForm } from '../lib/api'

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function notFoundResponse(): Response {
  return jsonResponse({ message: 'not found' }, 404)
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

  it('posts a multipart request and completes for Excel imports', async () => {
    const excelForm: ExcelImportForm = {
      file: new File(['id,adres'], 'senaryo.xlsx'),
      name: 'Excel senaryosu',
      arrivalDeadline: '08:30:00',
      destinationAddress: 'Kızılırmak Mah. 1443. Cad. No:5, Çankaya/Ankara',
    }
    const fetchMock = vi.mocked(fetch)
    fetchMock
      .mockResolvedValueOnce(notFoundResponse())
      .mockResolvedValueOnce(jsonResponse({ id: 'scenario-3', status: 'queued' }, 202))
      .mockResolvedValueOnce(
        jsonResponse({
          id: 'scenario-3',
          name: excelForm.name,
          status: 'completed',
          deadlineSeconds: 30600,
          stops: [],
          routes: [],
          unassignedPersonIds: [],
        }),
      )

    const { result } = renderHook(() => useScenarioSubmission())

    act(() => {
      void result.current.submitExcelImport(excelForm)
    })

    await waitFor(() => expect(result.current.scenarioState).toBe('completed'))
    const [url, options] = fetchMock.mock.calls[1]
    expect(url).toBe('http://localhost:8080/api/v1/scenarios/import')
    expect(options?.method).toBe('POST')
    expect(options?.body).toBeInstanceOf(FormData)
  })

  it('surfaces the backend error message when the scenario fails', async () => {
    const fetchMock = vi.mocked(fetch)
    fetchMock
      .mockResolvedValueOnce(notFoundResponse())
      .mockResolvedValueOnce(jsonResponse({ id: 'scenario-2', status: 'queued' }, 202))
      .mockResolvedValueOnce(
        jsonResponse({
          id: 'scenario-2',
          name: 'Excel senaryosu',
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
      void result.current.submitExcelImport({
        file: new File(['id,adres'], 'senaryo.xlsx'),
        name: 'Excel senaryosu',
        arrivalDeadline: '08:30:00',
        destinationAddress: 'Kızılırmak Mah. 1443. Cad. No:5, Çankaya/Ankara',
      })
    })

    await waitFor(() => expect(result.current.scenarioState).toBe('failed'))
    expect(result.current.errorMessage).toBe('VROOM hatası: no solution found')
  })

  it('surfaces a network error from the initial POST as a failed state', async () => {
    const fetchMock = vi.mocked(fetch)
    fetchMock
      .mockResolvedValueOnce(notFoundResponse())
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))

    const { result } = renderHook(() => useScenarioSubmission())

    act(() => {
      void result.current.submitExcelImport({
        file: new File(['id,adres'], 'senaryo.xlsx'),
        name: 'Excel senaryosu',
        arrivalDeadline: '08:30:00',
        destinationAddress: 'Kızılırmak Mah. 1443. Cad. No:5, Çankaya/Ankara',
      })
    })

    await waitFor(() => expect(result.current.scenarioState).toBe('failed'))
    expect(result.current.errorMessage).toBe('Failed to fetch')
  })

})
