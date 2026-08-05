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
}

export function VehicleListPanel({ vehicles, selectedVehicleId, onSelect, unassignedPersonCount }: VehicleListPanelProps) {
  return (
    <div className="op-vehicle-panel op-scroll" aria-label="Araç filosu">
      <div className="op-vehicle-panel-header">
        <div>
          <p className="op-kicker">Filo</p>
          <h3>Araçlar</h3>
        </div>
        <strong className="op-badge">{vehicles.length} araç</strong>
      </div>
      {unassignedPersonCount > 0 && (
        <p className="op-vehicle-panel-warning">{unassignedPersonCount} personel atanamadı</p>
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
