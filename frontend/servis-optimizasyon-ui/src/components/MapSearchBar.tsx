import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react'
import {
  findNearbyServices,
  getGeocodingSuggestions,
  type GeocodingSuggestion,
  type NearbyServicesResponse,
} from '../lib/api'

type MapSearchBarProps = {
  scenarioId: string
  result: NearbyServicesResponse | null
  onResult: (result: NearbyServicesResponse | null) => void
}

const MIN_QUERY_LENGTH = 3
const SUGGESTION_DEBOUNCE_MS = 300

function addressParts(address: string) {
  const [primary, ...secondary] = address.split(',').map((part) => part.trim()).filter(Boolean)
  return { primary: primary || address, secondary: secondary.join(', ') }
}

function isAbortError(reason: unknown) {
  return reason instanceof DOMException && reason.name === 'AbortError'
}

export function MapSearchBar({ scenarioId, result, onResult }: MapSearchBarProps) {
  const [address, setAddress] = useState('')
  const [suggestions, setSuggestions] = useState<GeocodingSuggestion[]>([])
  const [activeIndex, setActiveIndex] = useState(-1)
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [suggestionsBusy, setSuggestionsBusy] = useState(false)
  const [error, setError] = useState('')
  const [suggestionError, setSuggestionError] = useState('')
  const rootRef = useRef<HTMLDivElement>(null)
  const suggestionAbortRef = useRef<AbortController | null>(null)
  const suggestionTimeoutRef = useRef<number | null>(null)
  const searchAbortRef = useRef<AbortController | null>(null)
  const skipNextSuggestionFetchRef = useRef(false)
  const listboxId = useId()

  useEffect(() => {
    function closeWhenClickingOutside(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false)
        setActiveIndex(-1)
      }
    }

    document.addEventListener('pointerdown', closeWhenClickingOutside)
    return () => document.removeEventListener('pointerdown', closeWhenClickingOutside)
  }, [])

  useEffect(() => {
    suggestionAbortRef.current?.abort()
    suggestionAbortRef.current = null
    setSuggestionsBusy(false)

    if (skipNextSuggestionFetchRef.current) {
      skipNextSuggestionFetchRef.current = false
      return
    }

    const query = address.trim()
    if (query.length < MIN_QUERY_LENGTH) {
      setSuggestions([])
      setSuggestionError('')
      setOpen(false)
      setActiveIndex(-1)
      return
    }

    const timeout = window.setTimeout(() => {
      suggestionTimeoutRef.current = null
      const controller = new AbortController()
      suggestionAbortRef.current = controller
      setSuggestionsBusy(true)
      setSuggestionError('')

      getGeocodingSuggestions(query, controller.signal)
        .then((nextSuggestions) => {
          if (controller.signal.aborted) return
          setSuggestions(nextSuggestions)
          setOpen(nextSuggestions.length > 0)
          setActiveIndex(-1)
        })
        .catch((reason: unknown) => {
          if (isAbortError(reason)) return
          setSuggestions([])
          setOpen(false)
          setSuggestionError('Öneriler yüklenemedi. Enter ile arayabilirsiniz.')
        })
        .finally(() => {
          if (suggestionAbortRef.current === controller) {
            suggestionAbortRef.current = null
            setSuggestionsBusy(false)
          }
        })
    }, SUGGESTION_DEBOUNCE_MS)
    suggestionTimeoutRef.current = timeout

    return () => {
      window.clearTimeout(timeout)
      if (suggestionTimeoutRef.current === timeout) suggestionTimeoutRef.current = null
    }
  }, [address])

  useEffect(() => () => {
    suggestionAbortRef.current?.abort()
    if (suggestionTimeoutRef.current !== null) window.clearTimeout(suggestionTimeoutRef.current)
    suggestionTimeoutRef.current = null
    searchAbortRef.current?.abort()
  }, [])

  async function search(suggestion?: GeocodingSuggestion) {
    const query = (suggestion?.address ?? address).trim()
    if (!query || busy) return

    suggestionAbortRef.current?.abort()
    if (suggestionTimeoutRef.current !== null) window.clearTimeout(suggestionTimeoutRef.current)
    suggestionTimeoutRef.current = null
    setSuggestions([])
    setOpen(false)
    setActiveIndex(-1)
    setBusy(true)
    setError('')
    const controller = new AbortController()
    searchAbortRef.current = controller

    try {
      onResult(await findNearbyServices(
        scenarioId,
        query,
        suggestion?.location,
        controller.signal,
      ))
    } catch (reason) {
      if (!isAbortError(reason)) {
        setError(reason instanceof Error ? reason.message : 'Konum aranamadı.')
      }
    } finally {
      if (searchAbortRef.current === controller) {
        searchAbortRef.current = null
        setBusy(false)
      }
    }
  }

  function selectSuggestion(suggestion: GeocodingSuggestion) {
    skipNextSuggestionFetchRef.current = true
    setAddress(suggestion.address)
    setSuggestions([])
    setSuggestionError('')
    setOpen(false)
    setActiveIndex(-1)
    void search(suggestion)
  }

  function clear() {
    suggestionAbortRef.current?.abort()
    if (suggestionTimeoutRef.current !== null) window.clearTimeout(suggestionTimeoutRef.current)
    searchAbortRef.current?.abort()
    suggestionAbortRef.current = null
    suggestionTimeoutRef.current = null
    searchAbortRef.current = null
    skipNextSuggestionFetchRef.current = false
    setAddress('')
    setSuggestions([])
    setActiveIndex(-1)
    setOpen(false)
    setBusy(false)
    setSuggestionsBusy(false)
    setError('')
    setSuggestionError('')
    onResult(null)
  }

  function handleAddressChange(nextAddress: string) {
    searchAbortRef.current?.abort()
    searchAbortRef.current = null
    setBusy(false)
    setAddress(nextAddress)
    setError('')
    setSuggestionError('')
    setActiveIndex(-1)
    if (result && nextAddress !== result.address) onResult(null)
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'ArrowDown' && suggestions.length > 0) {
      event.preventDefault()
      setOpen(true)
      setActiveIndex((current) => current >= suggestions.length - 1 ? 0 : current + 1)
      return
    }
    if (event.key === 'ArrowUp' && suggestions.length > 0) {
      event.preventDefault()
      setOpen(true)
      setActiveIndex((current) => current <= 0 ? suggestions.length - 1 : current - 1)
      return
    }
    if (event.key === 'Escape') {
      setOpen(false)
      setActiveIndex(-1)
      return
    }
    if (event.key === 'Enter') {
      event.preventDefault()
      const selected = open && suggestions.length > 0
        ? suggestions[activeIndex >= 0 ? activeIndex : 0]
        : undefined
      if (selected) selectSuggestion(selected)
      else void search()
    }
  }

  const showSuggestions = open && suggestions.length > 0

  return (
    <div ref={rootRef} className={`op-map-search${showSuggestions ? ' is-open' : ''}`}>
      <div className="op-map-search-pill">
        <span className="op-map-search-lens" aria-hidden="true" />
        <input
          value={address}
          placeholder="Bir konum arayın…"
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={showSuggestions}
          aria-controls={listboxId}
          aria-activedescendant={activeIndex >= 0 ? `${listboxId}-${activeIndex}` : undefined}
          onChange={(event) => handleAddressChange(event.target.value)}
          onFocus={() => suggestions.length > 0 && setOpen(true)}
          onKeyDown={handleKeyDown}
        />
        {(busy || suggestionsBusy) && <span className="op-spinner" aria-hidden="true" />}
        {(result || address) && (
          <button type="button" className="op-map-search-clear" aria-label="Aramayı temizle" onClick={clear}>×</button>
        )}
      </div>

      {showSuggestions && (
        <ul id={listboxId} className="op-map-search-suggestions" role="listbox" aria-label="Adres önerileri">
          {suggestions.map((suggestion, index) => {
            const parts = addressParts(suggestion.address)
            return (
              <li key={`${suggestion.location.join('-')}-${suggestion.address}`} role="presentation">
                <button
                  id={`${listboxId}-${index}`}
                  type="button"
                  role="option"
                  aria-selected={activeIndex === index}
                  className={activeIndex === index ? 'is-active' : undefined}
                  onMouseEnter={() => setActiveIndex(index)}
                  onClick={() => selectSuggestion(suggestion)}
                >
                  <svg className="op-map-search-pin" viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M12 21s7-6.15 7-12A7 7 0 1 0 5 9c0 5.85 7 12 7 12Z" />
                    <circle cx="12" cy="9" r="2.4" />
                  </svg>
                  <span className="op-map-search-suggestion-text">
                    <strong>{parts.primary}</strong>
                    {parts.secondary && <span>{parts.secondary}</span>}
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
      )}

      {(error || suggestionError) && (
        <p className="op-map-search-error" role="status">{error || suggestionError}</p>
      )}
    </div>
  )
}
