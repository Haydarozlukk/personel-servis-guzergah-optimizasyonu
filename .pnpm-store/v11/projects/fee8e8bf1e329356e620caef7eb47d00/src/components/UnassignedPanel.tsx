import type { ScenarioResult, ScenarioVehicle } from '../lib/api'
import { vehicleHasAvailableSeat } from '../lib/manualPlan'

export function UnassignedPanel({
  plan, vehicles, onAssign, onDelete, onClose,
}: {
  plan: ScenarioResult
  vehicles: ScenarioVehicle[]
  onAssign: (personId: string, vehicleId: string) => void
  onDelete: (personId: string) => void
  onClose: () => void
}) {
  const people = plan.unassignedPersonIds.map((id) => plan.persons.find((person) => person.id === id)).filter(Boolean)
  return <div className="op-admin-layer"><section className="op-admin-panel op-scroll">
    <header><div><p className="op-kicker">Manuel yönetim</p><h2>Servis atanmamış yolcular</h2></div><button className="op-close" onClick={onClose}>×</button></header>
    {people.length === 0 && <p className="op-drawer-empty">Servis atanmamış yolcu yok.</p>}
    {people.map((person) => person && <article className="op-admin-user" key={person.id}>
      <div><strong>{person.name || person.id}</strong><span>{person.id}</span></div>
      <div>
        <select defaultValue="" onChange={(event) => event.target.value && onAssign(person.id, event.target.value)}>
          <option value="" disabled>Servise ata</option>
          {vehicles.map((vehicle) => {
            const available = vehicleHasAvailableSeat(plan, vehicle.id)
            return <option value={vehicle.id} key={vehicle.id} disabled={!available}>{vehicle.id}{available ? '' : ' · dolu'}</option>
          })}
        </select>
        <button className="op-btn op-btn-secondary" onClick={() => confirm('Bu yolcu veritabanından silinsin mi?') && onDelete(person.id)}>Kalıcı sil</button>
      </div>
    </article>)}
  </section></div>
}
