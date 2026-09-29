import type { ScenarioResult, ScenarioVehicle } from '../lib/api'
import { buildVehicleIdByPersonId } from '../lib/personHomes'
import { vehicleHasAvailableSeat } from '../lib/manualPlan'
import { useMemo, useState } from 'react'

export function AllPassengersPanel({
  plan, vehicles, onAssign, onDelete, onUpdateId, onSetActive, onClose,
  maxWalkingMeters,
}: {
  plan: ScenarioResult
  vehicles: ScenarioVehicle[]
  onAssign: (personId: string, vehicleId: string) => void
  onDelete: (personId: string) => void
  onUpdateId: (personId: string, nextPersonId: string) => void
  onSetActive: (personId: string, isActive: boolean) => void
  onClose: () => void
  maxWalkingMeters?: number
}) {
  const [query, setQuery] = useState('')
  const vehicleByPersonId = buildVehicleIdByPersonId(plan.routes, plan.stops)
  const vehicleLabel = (vehicle: Pick<ScenarioVehicle, 'id' | 'label' | 'plate'>) =>
    [vehicle.id, vehicle.label?.trim(), vehicle.plate?.trim()].filter(Boolean).join(' · ')

  const visiblePeople = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase('tr')
    const people = plan.persons.filter((person) => {
      if (!maxWalkingMeters) return true
      return plan.stops.some((stop) => stop.assignedPersonIds.includes(person.id)
        && (stop.walkingDistancesMeters[person.id] ?? 0) > maxWalkingMeters)
    })
    return people.filter((person) => !normalized || `${person.name || ''} ${person.id}`.toLocaleLowerCase('tr').includes(normalized))
      .sort((a, b) => (a.name || '').localeCompare(b.name || '', 'tr'))
  }, [maxWalkingMeters, plan.persons, plan.stops, query])

  return <div className="op-admin-layer"><section className="op-admin-panel op-scroll">
    <header><div><p className="op-kicker">Manuel yönetim</p><h2>{maxWalkingMeters ? `${maxWalkingMeters} m üzeri yürüyen yolcular` : 'Tüm yolcular'}</h2></div><button className="op-close" onClick={onClose}>×</button></header>
    <p className="op-all-passengers-note">Pasif yolcunun durağı kaldırılır ve evi haritada gri görünür. Yeniden etkinleştirildiğinde servis ataması yapılmalıdır.</p>
    <label className="op-passenger-filter">
      <span>Yolcu ara</span>
      <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Ad, soyad veya sicil" autoFocus />
    </label>
    {visiblePeople.map((person) => {
      const currentVehicleId = vehicleByPersonId.get(person.id) ?? person.assignedVehicleId ?? ''
      const isActive = person.isActive ?? true
      return <article className="op-admin-user op-all-passenger" key={person.id}>
        <div><strong>{person.name || person.id}</strong><span>{isActive ? (currentVehicleId || 'servis atanmamış') : 'pasif'}{maxWalkingMeters ? ` · ${Math.round(plan.stops.find((stop) => stop.assignedPersonIds.includes(person.id))?.walkingDistancesMeters[person.id] ?? 0)} m` : ''}</span></div>
        <label className="op-passenger-active"><input type="checkbox" checked={isActive} onChange={(event) => onSetActive(person.id, event.target.checked)} /> Aktif</label>
        <label className="op-passenger-id"><span>Sicil</span><input defaultValue={person.id} aria-label={`${person.name || person.id} sicil numarası`} onBlur={(event) => onUpdateId(person.id, event.target.value)} /></label>
        <select
          aria-label={`${person.name || person.id} servis seçimi`}
          value={currentVehicleId}
          disabled={!isActive}
          onChange={(event) => {
            const nextVehicleId = event.target.value
            if (nextVehicleId && nextVehicleId !== currentVehicleId) onAssign(person.id, nextVehicleId)
          }}
        >
          <option value="" disabled>Servis atanmamış</option>
          {vehicles.map((vehicle) => {
            const available = vehicle.id === currentVehicleId || vehicleHasAvailableSeat(plan, vehicle.id)
            return <option value={vehicle.id} key={vehicle.id} disabled={!available}>
              {vehicleLabel(vehicle)}{available ? '' : ' · dolu'}
            </option>
          })}
        </select>
        <button
          type="button"
          className="op-btn op-btn-danger op-btn-small"
          onClick={() => confirm(`${person.name || person.id} aktif plandan silinsin mi? Bu işlem geri alınamaz.`) && onDelete(person.id)}
        >
          Sil
        </button>
      </article>
    })}
    {visiblePeople.length === 0 && <p className="op-drawer-empty">Aramanızla eşleşen yolcu bulunamadı.</p>}
  </section></div>
}
