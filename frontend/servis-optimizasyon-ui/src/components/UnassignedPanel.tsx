import type { ScenarioResult, ScenarioVehicle } from '../lib/api'
import { findCandidateVehicles, vehicleHasAvailableSeat } from '../lib/manualPlan'

const REASON_LABELS: Record<string, string> = {
  no_candidate_within_limit: '500 m yürüme mesafesinde uygun durak bulunamadı (konum, yürünebilir yol ağına iyi bağlı olmayabilir).',
  no_route: 'Bu konuma yürüme rotası hiç hesaplanamadı (OSRM erişemedi ya da adres hatalı).',
  stop_capacity_full: 'Yakındaki duraklar/araçlar dolu; boş koltuk bulunamadı.',
  not_routed: 'Araç rotalaması bu durağı kapsayamadı (VROOM çözümü dışında kaldı).',
  manual_unassigned: 'Elle servisten çıkarıldı.',
}

function reasonLabel(reason?: string): string {
  if (!reason) return 'Sebep bilinmiyor.'
  return REASON_LABELS[reason] ?? reason
}

export function UnassignedPanel({
  plan, vehicles, onAssign, onDelete, onClose,
}: {
  plan: ScenarioResult
  vehicles: ScenarioVehicle[]
  onAssign: (personId: string, vehicleId: string) => void
  onDelete: (personId: string) => void
  onClose: () => void
}) {
  const reasonById = new Map((plan.unassignedPersons ?? []).map((item) => [item.id, item.reason]))
  const vehicleLabel = (vehicle: Pick<ScenarioVehicle, 'id' | 'label' | 'plate'>) => [vehicle.id, vehicle.label?.trim(), vehicle.plate?.trim()].filter(Boolean).join(' · ')
  const people = plan.unassignedPersonIds.map((id) => plan.persons.find((person) => person.id === id)).filter(Boolean)
  return <div className="op-admin-layer"><section className="op-admin-panel op-scroll">
    <header><div><p className="op-kicker">Manuel yönetim</p><h2>Servis atanmamış yolcular</h2></div><button className="op-close" onClick={onClose}>×</button></header>
    {people.length === 0 && <p className="op-drawer-empty">Servis atanmamış yolcu yok.</p>}
    {people.map((person) => {
      if (!person) return null
      const candidates = findCandidateVehicles(plan, person.id, 5)
      return <article className="op-admin-user op-unassigned-user" key={person.id}>
        <div><strong>{person.name || person.id}</strong><span>{person.id}</span></div>
        <p className="op-unassigned-reason">{reasonLabel(reasonById.get(person.id))}</p>
        {candidates.length > 0 && (
          <ul className="op-unassigned-candidates">
            {candidates.map((candidate) => (
              <li key={candidate.vehicleId}>
                <button
                  type="button"
                  className="op-btn op-btn-secondary"
                  onClick={() => onAssign(person.id, candidate.vehicleId)}
                >
                  {vehicleLabel(vehicles.find((vehicle) => vehicle.id === candidate.vehicleId) ?? { id: candidate.vehicleId })} · {Math.round(candidate.distanceMeters)} m · {candidate.availableSeats} boş koltuk
                </button>
              </li>
            ))}
          </ul>
        )}
        <div>
          <select defaultValue="" onChange={(event) => event.target.value && onAssign(person.id, event.target.value)}>
            <option value="" disabled>Tüm servislerden seç</option>
            {vehicles.map((vehicle) => {
              const available = vehicleHasAvailableSeat(plan, vehicle.id)
              return <option value={vehicle.id} key={vehicle.id} disabled={!available}>{vehicleLabel(vehicle)}{available ? '' : ' · dolu'}</option>
            })}
          </select>
          <button className="op-btn op-btn-secondary" onClick={() => confirm('Bu yolcu veritabanından silinsin mi?') && onDelete(person.id)}>Kalıcı sil</button>
        </div>
      </article>
    })}
  </section></div>
}
