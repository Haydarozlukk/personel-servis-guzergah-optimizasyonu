import type { ScenarioResult, ScenarioVehicle } from '../lib/api'
import { buildVehicleIdByPersonId } from '../lib/personHomes'
import { vehicleHasAvailableSeat } from '../lib/manualPlan'
import { useMemo, useState } from 'react'

export function AllPassengersPanel({
  plan, vehicles, onAssign, onDelete, onClose,
}: {
  plan: ScenarioResult
  vehicles: ScenarioVehicle[]
  onAssign: (personId: string, vehicleId: string) => void
  onDelete: (personId: string) => void
  onClose: () => void
}) {
  const [query, setQuery] = useState('')
  const vehicleByPersonId = buildVehicleIdByPersonId(plan.routes, plan.stops)
  const vehicleLabel = (vehicle: Pick<ScenarioVehicle, 'id' | 'label' | 'plate'>) =>
    [vehicle.id, vehicle.label?.trim(), vehicle.plate?.trim()].filter(Boolean).join(' · ')

  const visiblePeople = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase('tr')
    if (!normalized) return plan.persons
    return plan.persons.filter((person) => `${person.name || ''} ${person.id}`.toLocaleLowerCase('tr').includes(normalized))
  }, [plan.persons, query])

  return <div className="op-admin-layer"><section className="op-admin-panel op-scroll">
    <header><div><p className="op-kicker">Manuel yönetim</p><h2>Tüm yolcular</h2></div><button className="op-close" onClick={onClose}>×</button></header>
    <p className="op-all-passengers-note">Yolcuyu seçip başka bir servise taşıyabilir veya aktif plandan silebilirsiniz. Seçilen serviste boş koltuk olmalıdır.</p>
    <label className="op-passenger-filter">
      <span>Yolcu ara</span>
      <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Ad, soyad veya sicil" autoFocus />
    </label>
    {visiblePeople.map((person) => {
      const currentVehicleId = vehicleByPersonId.get(person.id) ?? ''
      return <article className="op-admin-user op-all-passenger" key={person.id}>
        <div><strong>{person.name || person.id}</strong><span>{person.id} · {currentVehicleId || 'servis atanmamış'}</span></div>
        <select
          aria-label={`${person.name || person.id} servis seçimi`}
          value={currentVehicleId}
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
