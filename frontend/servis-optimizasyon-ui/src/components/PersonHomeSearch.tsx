import { useMemo, useState } from 'react'
import type { ScenarioResult } from '../lib/api'

export function PersonHomeSearch({
  persons,
  onSelect,
}: {
  persons: ScenarioResult['persons']
  onSelect: (location: number[]) => void
}) {
  const [query, setQuery] = useState('')
  const matches = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase('tr')
    if (normalized.length < 2) return []
    return persons
      .filter((person) => `${person.name || ''} ${person.id}`.toLocaleLowerCase('tr').includes(normalized))
      .slice(0, 8)
  }, [persons, query])

  function choose(person: ScenarioResult['persons'][number]) {
    setQuery(person.name || person.id)
    onSelect(person.location)
  }

  return (
    <div className="op-person-home-search">
      <label>
        <span className="op-map-search-lens" aria-hidden="true" />
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Personel ara, evine git…"
          aria-label="Personel ara"
        />
        {query && <button type="button" aria-label="Personel aramasını temizle" onClick={() => setQuery('')}>×</button>}
      </label>
      {matches.length > 0 && (
        <ul aria-label="Personel arama sonuçları">
          {matches.map((person) => (
            <li key={person.id}>
              <button type="button" onClick={() => choose(person)}>
                <strong>{person.name || person.id}</strong><span>{person.id}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
