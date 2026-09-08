import type { ScenarioResult, ScenarioVehicle } from '../lib/api'
import { buildVehicleIdByPersonId } from '../lib/personHomes'
import { vehicleHasAvailableSeat } from '../lib/manualPlan'

export function AllPassengersPanel({
  plan, vehicles, onAssign, onClose,
}: {
  plan: ScenarioResult
  vehicles: ScenarioVehicle[]
  onAssign: (personId: string, vehicleId: string) => void
  onClose: () => void
}) {
  const vehicleByPersonId = buildVehicleIdByPersonId(plan.routes, plan.stops)
  const vehicleLabel = (vehicle: Pick<ScenarioVehicle, 'id' | 'label' | 'plate'>) =>
    [vehicle.id, vehicle.label?.trim(), vehicle.plate?.trim()].filter(Boolean).join(' · ')

  return <div className="op-admin-layer"><section className="op-admin-panel op-scroll">
    <header><div><p className="op-kicker">Manuel yönetim</p><h2>Tüm yolcular</h2></div><button className="op-close" onClick={onClose}>×</button></header>
    <p className="op-all-passengers-note">Yolcuyu seçip başka bir servise taşıyabilirsin. Seçilen serviste boş koltuk olmalıdır.</p>
    {plan.persons.map((person) => {
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
      </article>
    })}
  </section></div>
}
