import type { ScenarioVehicle } from '../lib/api'

type UnassignedVehicleListProps = {
  vehicles: ScenarioVehicle[]
}

export function UnassignedVehicleList({ vehicles }: UnassignedVehicleListProps) {
  if (vehicles.length === 0) return null

  return (
    <section className="unassigned-vehicles" aria-label="Rota atanmayan araçlar">
      <div className="result-card-header">
        <div>
          <p className="section-kicker">Yedek filo</p>
          <h2>Rota atanmayan araçlar</h2>
        </div>
        <strong>{vehicles.length} araç</strong>
      </div>
      <ul>
        {vehicles.map((vehicle) => (
          <li key={vehicle.id}>
            <strong>{vehicle.id}</strong>
            <span>{vehicle.capacity} kişi</span>
            <small>{vehicle.start[1].toFixed(5)}, {vehicle.start[0].toFixed(5)}</small>
          </li>
        ))}
      </ul>
    </section>
  )
}
