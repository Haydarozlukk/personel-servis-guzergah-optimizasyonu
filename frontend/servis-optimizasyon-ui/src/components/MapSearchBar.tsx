import { useState } from 'react'
import { findNearbyServices, type NearbyServicesResponse } from '../lib/api'

type MapSearchBarProps = {
  scenarioId: string
  result: NearbyServicesResponse | null
  onResult: (result: NearbyServicesResponse | null) => void
}

export function MapSearchBar({ scenarioId, result, onResult }: MapSearchBarProps) {
  const [address, setAddress] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function search() {
    const query = address.trim()
    if (!query || busy) return
    setBusy(true)
    setError('')
    try {
      onResult(await findNearbyServices(scenarioId, query))
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Konum aranamadı.')
    } finally {
      setBusy(false)
    }
  }

  function clear() {
    setAddress('')
    setError('')
    onResult(null)
  }

  return (
    <div className="op-map-search">
      <div className="op-map-search-pill">
        <span className="op-map-search-lens" aria-hidden="true" />
        <input
          value={address}
          placeholder="Bir konum arayın…"
          onChange={(event) => setAddress(event.target.value)}
          onKeyDown={(event) => event.key === 'Enter' && void search()}
        />
        {busy && <span className="op-spinner" aria-hidden="true" />}
        {(result || address) && !busy && (
          <button type="button" className="op-map-search-clear" aria-label="Aramayı temizle" onClick={clear}>×</button>
        )}
      </div>
      {error && <p className="op-map-search-error">{error}</p>}
    </div>
  )
}
