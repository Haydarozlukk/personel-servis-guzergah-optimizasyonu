export type VehicleRow = {
  id: string
  capacity: number
  summary: string
  routed: boolean
  color: string
}

type VehicleListPanelProps = {
  vehicles: VehicleRow[]
  selectedVehicleId: string | null
  onSelect: (id: string) => void
  unassignedPersonCount: number
  onOpenUnassigned: () => void
  onAddVehicle: () => void
}

export function VehicleListPanel({ vehicles, selectedVehicleId, onSelect, unassignedPersonCount, onOpenUnassigned, onAddVehicle }: VehicleListPanelProps) {
  return (
    <div className="op-vehicle-panel op-scroll" aria-label="Araç filosu">
      <div className="op-vehicle-panel-header">
        <div>
          <p className="op-kicker">Filo</p>
          <h3>Araçlar</h3>
        </div>
        <button className="op-badge op-badge-button" onClick={onAddVehicle}>+ Araç</button>
      </div>
      {unassignedPersonCount > 0 && (
        <button className="op-vehicle-panel-warning op-warning-button" onClick={onOpenUnassigned}>{unassignedPersonCount} yolcu servis atanmamış · aç</button>
      )}
      <ul className="op-vehicle-list">
        {vehicles.map((vehicle) => {
          const selected = vehicle.id === selectedVehicleId
          return (
            <li key={vehicle.id}>
              <button
                type="button"
                className={`op-vehicle-row${selected ? ' selected' : ''}`}
                onClick={() => onSelect(vehicle.id)}
              >
                <div className="op-vehicle-row-top">
                  <span className="op-vehicle-row-name">
                    <i style={{ background: vehicle.routed ? vehicle.color : 'var(--border-strong)' }} />
                    {vehicle.id}
                  </span>
                  <span className="op-vehicle-row-capacity">{vehicle.capacity} kişi</span>
                </div>
                <span className={`op-vehicle-row-summary${vehicle.routed ? '' : ' unrouted'}`}>{vehicle.summary}</span>
              </button>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
