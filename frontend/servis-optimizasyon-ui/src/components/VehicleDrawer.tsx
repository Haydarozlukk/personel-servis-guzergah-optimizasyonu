import { useEffect, useMemo, useState } from 'react'
import type { ScenarioResult, ScenarioRoute, ScenarioStop, ScenarioVehicle } from '../lib/api'

import { getStopDisplayName } from '../lib/stopName'

type VehicleDrawerProps = {
  vehicleId: string
  vehicle: ScenarioVehicle | undefined
  route: ScenarioRoute | undefined
  stops: ScenarioStop[]
  persons: ScenarioResult['persons']
  unassignedPersonIds: string[]
  vehicles: ScenarioVehicle[]
  allRoutes: ScenarioRoute[]
  workplace: number[] | null
  color: string
  onClose: () => void
  onUpdateVehicle: (patch: Partial<ScenarioVehicle>) => void
  onMovePerson: (personId: string, vehicleId: string) => void
  onUnassignPerson: (personId: string) => void
  onPickStop: () => void
  onMoveStop: (stopId: string, direction: -1 | 1) => void
  onAssignToStop: (personId: string, stopId: string) => void
  onDeleteVehicle: () => void
  onSelectStop?: (location: number[]) => void
}

export function VehicleDrawer(props: VehicleDrawerProps) {
  const { vehicleId, vehicle, route, stops, persons, vehicles, workplace, color, onClose } = props
  const routeStops = route ? route.stopIds.map((id) => stops.find((stop) => stop.id === id)).filter((stop): stop is ScenarioStop => !!stop) : []
  const personIds = routeStops.flatMap((stop) => stop.assignedPersonIds)
  const personMap = useMemo(() => new Map(persons.map((person) => [person.id, person])), [persons])
  const unassignedPeople = persons.filter((person) => props.unassignedPersonIds.includes(person.id))
  const [plate, setPlate] = useState(vehicle?.plate ?? '')
  const [label, setLabel] = useState(vehicle?.label ?? '')
  const [capacity, setCapacity] = useState<number>(vehicle?.capacity ?? 18)
  const [reservedSeats, setReservedSeats] = useState(vehicle?.reservedSeats ?? 0)

  useEffect(() => {
    setPlate(vehicle?.plate ?? '')
    setLabel(vehicle?.label ?? '')
    setCapacity(vehicle?.capacity ?? 18)
    setReservedSeats(vehicle?.reservedSeats ?? 0)
  }, [vehicle])

  const effectiveCapacity = capacity - reservedSeats
  const capacityReached = personIds.length >= effectiveCapacity
  const invalidCapacityChange = effectiveCapacity < personIds.length
  const suggestedCapacity = Math.max(1, personIds.length + reservedSeats)

  function passengerSuggestion(personId: string): string | null {
    const person = personMap.get(personId)
    if (!person) return null
    const distance = (stop: ScenarioStop) => Math.hypot(stop.location[0] - person.location[0], stop.location[1] - person.location[1])
    const currentDistance = routeStops.length ? Math.min(...routeStops.map(distance)) : Number.POSITIVE_INFINITY
    const alternative = vehicles
      .filter((item) => item.id !== vehicleId)
      .map((item) => {
        const otherRoute = props.allRoutes.find((candidate) => candidate.vehicleId === item.id)
        const otherStops = (otherRoute?.stopIds ?? []).map((id) => stops.find((stop) => stop.id === id)).filter((stop): stop is ScenarioStop => !!stop)
        return { id: item.id, distance: otherStops.length ? Math.min(...otherStops.map(distance)) : Number.POSITIVE_INFINITY }
      })
      .sort((a, b) => a.distance - b.distance)[0]
    return alternative && alternative.distance < currentDistance * 0.85
      ? `${alternative.id} güzergâhı bu yolcunun konumuna daha yakın görünüyor. Manuel atama değiştirilmedi.`
      : null
  }

  return (
    <div className="op-drawer">
      <div className="op-drawer-card">
        <div className="op-drawer-card-header">
          <div><p className="op-kicker">Araç ve yolcular</p><h3>{vehicle?.label || vehicleId}</h3></div>
          <button type="button" className="op-close" aria-label="Kapat" onClick={onClose}>×</button>
        </div>
        <div className="op-drawer-card-body op-scroll">
          <div className="op-vehicle-editor">
            <label>İsim<input placeholder={vehicleId} value={label} onChange={(event) => setLabel(event.target.value)} /></label>
            <label>Plaka<input value={plate} onChange={(event) => setPlate(event.target.value)} /></label>
            <label>Fiziksel kapasite<input type="number" min={1} step={1} value={capacity} onChange={(event) => {
              const next = Math.max(1, Math.trunc(event.target.valueAsNumber || 1))
              setCapacity(next)
              if (reservedSeats >= next) setReservedSeats(next - 1)
            }} /></label>
            <label>Boş bırakılacak koltuk<input type="number" min={0} max={capacity - 1} step={1} value={reservedSeats} onChange={(event) => setReservedSeats(Math.min(capacity - 1, Math.max(0, Math.trunc(event.target.valueAsNumber || 0))))} /></label>
            <button className="op-btn op-btn-secondary" disabled={invalidCapacityChange} onClick={() => props.onUpdateVehicle({ label: label.trim() || null, plate: plate || null, capacity, reservedSeats, effectiveCapacity })}>Araç ayarını kaydet</button>
            <button className="op-btn op-btn-danger" disabled={vehicles.length <= 1} onClick={() => confirm(`${vehicleId} silinsin mi? Yolcular servis atanmamış listesine taşınacak.`) && props.onDeleteVehicle()}>Aracı kaldır</button>
          </div>
          <p className={`op-capacity-note${capacityReached ? ' warning' : ''}`}>
            {personIds.length}/{effectiveCapacity} etkin koltuk · {Math.max(0, effectiveCapacity - personIds.length)} boş
            {capacityReached ? ' · Servis maksimum kapasiteye ulaştı.' : ''}
          </p>
          {invalidCapacityChange && <p className="op-error-text">Etkin kapasite mevcut {personIds.length} yolcudan küçük olamaz.</p>}
          {suggestedCapacity !== capacity && <p className="op-advice-note">⚑ Araç önerisi: mevcut yolcu ve rezerv koltuk sayısı için {suggestedCapacity} kişilik araç yeterli görünüyor. Araç otomatik değiştirilmedi.</p>}
          <p className="op-drawer-label">Yolcular ({personIds.length})</p>
          {personIds.length === 0 && <p className="op-drawer-empty">Bu serviste yolcu yok.</p>}
          <ul className="op-drawer-person-list">
            {personIds.map((personId) => {
              const suggestion = passengerSuggestion(personId)
              return <li key={personId} className="op-person-editor-row">
              <span><strong>{personMap.get(personId)?.name || personId} {suggestion && <i className="op-suggestion-icon" title={suggestion}>i</i>}</strong><small>{personId}</small></span>
              <select aria-label={`${personId} servis seçimi`} value={vehicleId} onChange={(event) => props.onMovePerson(personId, event.target.value)}>
                {vehicles.map((item) => {
                  const targetLoad = props.allRoutes.find((candidate) => candidate.vehicleId === item.id)?.stopIds
                    .flatMap((id) => stops.find((stop) => stop.id === id)?.assignedPersonIds ?? []).length ?? 0
                  const full = item.id !== vehicleId && targetLoad >= item.effectiveCapacity
                  return <option value={item.id} key={item.id} disabled={full}>{item.id}{full ? ' · dolu' : ''}</option>
                })}
              </select>
              <button className="op-icon-danger" title="Servis atanmamış listesine taşı" onClick={() => props.onUnassignPerson(personId)}>−</button>
            </li>})}
          </ul>
          <p className="op-advice-note">ⓘ Manuel atamalar korunur. Öneri simgeleri yalnızca daha dengeli bir alternatif olduğunu bildirir.</p>
        </div>
      </div>

      <div className="op-drawer-card">
        <div className="op-drawer-card-header">
          <div><p className="op-kicker">Güzergâh</p><h3>Kullanıcı sıralaması</h3></div>
          <button className="op-btn op-btn-secondary op-btn-small" onClick={props.onPickStop}>+ Haritadan durak</button>
        </div>
        <div className="op-drawer-card-body op-scroll">
          <ul className="op-drawer-stop-list">
            <li
              style={{ cursor: vehicle?.start ? 'pointer' : 'default' }}
              onClick={() => vehicle?.start && props.onSelectStop?.(vehicle.start)}
              title="Haritada başlangıç noktasına git"
            >
              <i style={{ background: color }} />
              <span><strong>Başlangıç</strong> · {vehicle?.start ? `${vehicle.start[1].toFixed(4)}, ${vehicle.start[0].toFixed(4)}` : 'ilk yolcu durağı'}</span>
            </li>
            {routeStops.map((stop, index) => {
              const displayName = getStopDisplayName(stop, personMap, index)
              return (
                <li
                  key={stop.id}
                  className="op-stop-editor-row"
                  style={{ cursor: 'pointer' }}
                  onClick={() => props.onSelectStop?.(stop.location)}
                  title="Haritada bu durağa git"
                >
                  <i className="op-dot-stop" />
                  <span>
                    <strong>{displayName}</strong> · {stop.assignedPersonIds.length} kişi
                    {unassignedPeople.length > 0 && (
                      <select
                        defaultValue=""
                        disabled={capacityReached}
                        onClick={(e) => e.stopPropagation()}
                        onChange={(event) => {
                          event.stopPropagation()
                          if (event.target.value) props.onAssignToStop(event.target.value, stop.id)
                          event.target.value = ''
                        }}
                      >
                        <option value="" disabled>
                          {capacityReached ? 'Kapasite dolu' : '+ Yolcu ekle'}
                        </option>
                        {unassignedPeople.map((person) => (
                          <option value={person.id} key={person.id}>
                            {person.name || person.id}
                          </option>
                        ))}
                      </select>
                    )}
                  </span>
                  <span className="op-order-buttons" onClick={(e) => e.stopPropagation()}>
                    <button
                      disabled={index === 0}
                      onClick={(e) => {
                        e.stopPropagation()
                        props.onMoveStop(stop.id, -1)
                      }}
                    >
                      ↑
                    </button>
                    <button
                      disabled={index === routeStops.length - 1}
                      onClick={(e) => {
                        e.stopPropagation()
                        props.onMoveStop(stop.id, 1)
                      }}
                    >
                      ↓
                    </button>
                  </span>
                </li>
              )
            })}
            <li
              style={{ cursor: workplace ? 'pointer' : 'default' }}
              onClick={() => workplace && props.onSelectStop?.(workplace)}
              title="Haritada varış noktasına git"
            >
              <i className="op-dot-workplace" />
              <span><strong>Varış</strong> · {workplace ? `${workplace[1].toFixed(4)}, ${workplace[0].toFixed(4)}` : '—'}</span>
            </li>
          </ul>
        </div>
      </div>
    </div>
  )
}
