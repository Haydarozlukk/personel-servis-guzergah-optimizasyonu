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

  // Bu fixture'larda yapılandırılmış alan yok; test böylece display_name'i virgülden
  // bölen geriye dönük uyum yolunun regresyon testi olarak duruyor.
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

  describe('structured suggestions', () => {
    // Gerçek Nominatim cevabına göre: mahalle `suburb`, ilçe `town`, il `state`.
    const building: GeocodingSuggestion = {
      address: '49, 3053. Cadde, Yenikent, Yaşamkent Mahallesi, Çankaya, Ankara, 06810, Türkiye',
      location: [32.6665836, 39.8695189],
      houseNumber: '49',
      street: '3053. Cadde',
      neighbourhood: 'Yaşamkent Mahallesi',
      district: 'Çankaya',
      city: 'Ankara',
    }

    it('renders the street with its building number instead of the raw display name', async () => {
      vi.mocked(getGeocodingSuggestions).mockResolvedValue([building])
      const { input } = renderSearch()

      fireEvent.change(input, { target: { value: '3053. Cadde No: 49' } })
      await finishDebounce()

      expect(screen.getByText('3053. Cadde No: 49')).toBeInTheDocument()
      expect(screen.getByText('Yaşamkent Mahallesi, Çankaya, Ankara')).toBeInTheDocument()
    })

    it('drops repeated administrative names from the secondary line', async () => {
      vi.mocked(getGeocodingSuggestions).mockResolvedValue([
        { ...building, neighbourhood: 'Çankaya', district: 'Çankaya' },
      ])
      const { input } = renderSearch()

      fireEvent.change(input, { target: { value: '3053. Cadde No: 49' } })
      await finishDebounce()

      expect(screen.getByText('Çankaya, Ankara')).toBeInTheDocument()
    })

    it('shows a bare street when the result has no building number', async () => {
      vi.mocked(getGeocodingSuggestions).mockResolvedValue([
        { ...building, houseNumber: null, address: '3053. Cadde, Çankaya, Ankara' },
      ])
      const { input } = renderSearch()

      fireEvent.change(input, { target: { value: '3053. Cadde' } })
      await finishDebounce()

      expect(screen.getByText('3053. Cadde')).toBeInTheDocument()
      expect(screen.queryByText(/No:/)).not.toBeInTheDocument()
    })

    it('marks only building-level suggestions with the building affordance', async () => {
      vi.mocked(getGeocodingSuggestions).mockResolvedValue([
        building,
        { ...building, houseNumber: null, address: '3053. Cadde, Çankaya, Ankara' },
      ])
      const { input } = renderSearch()

      fireEvent.change(input, { target: { value: '3053. Cadde' } })
      await finishDebounce()

      const [buildingOption, streetOption] = screen.getAllByRole('option')
      expect(buildingOption).toHaveClass('is-building')
      expect(streetOption).not.toHaveClass('is-building')
    })

    it('still searches with the raw display name so the backend echo matches', async () => {
      vi.mocked(getGeocodingSuggestions).mockResolvedValue([building])
      const { input } = renderSearch()
      fireEvent.change(input, { target: { value: '3053. Cadde No: 49' } })
      await finishDebounce()

      await act(async () => {
        fireEvent.click(screen.getByRole('option', { name: /3053\. Cadde/ }))
      })

      expect(findNearbyServices).toHaveBeenCalledWith(
        'scenario-1',
        building.address,
        building.location,
        expect.any(AbortSignal),
      )
    })
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
