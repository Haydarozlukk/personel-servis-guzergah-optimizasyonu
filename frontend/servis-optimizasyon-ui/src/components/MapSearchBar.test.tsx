import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MapSearchBar } from './MapSearchBar'
import {
  findNearbyServices,
  getGeocodingSuggestions,
  type GeocodingSuggestion,
  type NearbyServicesResponse,
} from '../lib/api'

vi.mock('../lib/api', () => ({
  findNearbyServices: vi.fn(),
  getGeocodingSuggestions: vi.fn(),
}))

const suggestions: GeocodingSuggestion[] = [
  { address: 'Koza 1 Caddesi, Çankaya, Ankara', location: [32.81, 39.98] },
  { address: 'Koza Sokak, Akyurt, Ankara', location: [33.08, 40.12] },
]

const nearbyResult: NearbyServicesResponse = {
  address: suggestions[0].address,
  location: suggestions[0].location,
  services: [],
}

function renderSearch(onResult = vi.fn()) {
  render(
    <MapSearchBar
      scenarioId="scenario-1"
      result={null}
      onResult={onResult}
    />,
  )
  return { input: screen.getByRole('combobox'), onResult }
}

async function finishDebounce() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(300)
  })
}

describe('MapSearchBar', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.clearAllMocks()
    vi.mocked(getGeocodingSuggestions).mockResolvedValue(suggestions)
    vi.mocked(findNearbyServices).mockResolvedValue(nearbyResult)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('does not request suggestions before three characters', async () => {
    const { input } = renderSearch()

    fireEvent.change(input, { target: { value: 'ko' } })
    await finishDebounce()

    expect(getGeocodingSuggestions).not.toHaveBeenCalled()
  })

  it('loads and displays suggestions after the debounce', async () => {
    const { input } = renderSearch()

    fireEvent.change(input, { target: { value: 'koza 1' } })
    await finishDebounce()

    expect(getGeocodingSuggestions).toHaveBeenCalledWith('koza 1', expect.any(AbortSignal))
    expect(screen.getByRole('option', { name: /Koza 1 Caddesi/ })).toBeInTheDocument()
    expect(screen.getByText('Çankaya, Ankara')).toBeInTheDocument()
  })

  it('immediately searches the selected suggestion with its coordinates', async () => {
    const onResult = vi.fn()
    const { input } = renderSearch(onResult)
    fireEvent.change(input, { target: { value: 'koza' } })
    await finishDebounce()

    await act(async () => {
      fireEvent.click(screen.getByRole('option', { name: /Koza 1 Caddesi/ }))
    })

    expect(findNearbyServices).toHaveBeenCalledWith(
      'scenario-1',
      suggestions[0].address,
      suggestions[0].location,
      expect.any(AbortSignal),
    )
    expect(onResult).toHaveBeenCalledWith(nearbyResult)
    expect(input).toHaveValue(suggestions[0].address)
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })

  it('supports arrow keys and Enter for suggestion selection', async () => {
    const { input } = renderSearch()
    fireEvent.change(input, { target: { value: 'koza' } })
    await finishDebounce()

    fireEvent.keyDown(input, { key: 'ArrowDown' })
    fireEvent.keyDown(input, { key: 'ArrowDown' })
    await act(async () => {
      fireEvent.keyDown(input, { key: 'Enter' })
    })

    expect(findNearbyServices).toHaveBeenCalledWith(
      'scenario-1',
      suggestions[1].address,
      suggestions[1].location,
      expect.any(AbortSignal),
    )
  })

  it('aborts a pending suggestion request when cleared', async () => {
    let requestSignal: AbortSignal | undefined
    vi.mocked(getGeocodingSuggestions).mockImplementation((_query, signal) => {
      requestSignal = signal
      return new Promise(() => {})
    })
    const onResult = vi.fn()
    const { input } = renderSearch(onResult)
    fireEvent.change(input, { target: { value: 'koza' } })
    await finishDebounce()

    fireEvent.click(screen.getByRole('button', { name: 'Aramayı temizle' }))

    expect(requestSignal?.aborted).toBe(true)
    expect(input).toHaveValue('')
    expect(onResult).toHaveBeenCalledWith(null)
  })
})
