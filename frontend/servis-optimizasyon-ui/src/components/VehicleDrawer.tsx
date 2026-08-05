import type { ScenarioRoute, ScenarioStop, ScenarioVehicle } from '../lib/api'

type VehicleDrawerProps = {
  vehicleId: string
  vehicle: ScenarioVehicle | undefined
  route: ScenarioRoute | undefined
  stops: ScenarioStop[]
  workplace: number[] | null
  color: string
  onClose: () => void
}

export function VehicleDrawer({ vehicleId, vehicle, route, stops, workplace, color, onClose }: VehicleDrawerProps) {
  const hasRoute = !!route
  const routeStops = route ? route.stopIds.map((id) => stops.find((s) => s.id === id)).filter((s): s is ScenarioStop => !!s) : []
  const personIds = routeStops.flatMap((stop) => stop.assignedPersonIds)

  return (
    <>
      <div className="op-drawer-scrim" onClick={onClose} />
      <div className="op-drawer">
        <div className="op-drawer-card">
          <div className="op-drawer-card-header">
            <div>
              <p className="op-kicker">Araç detayı</p>
              <h3>{vehicleId}</h3>
            </div>
            <button type="button" className="op-close" aria-label="Kapat" onClick={onClose}>
              ×
            </button>
          </div>
          <div className="op-drawer-card-body op-scroll">
            {hasRoute ? (
              <>
                <p className="op-drawer-label">Kişiler ({personIds.length})</p>
                <ul className="op-drawer-person-list">
                  {personIds.map((personId) => (
                    <li key={personId}>{personId}</li>
                  ))}
                </ul>
                <p className="op-drawer-note">Not: backend ad/soyad döndürmüyor, ID'ler gösteriliyor.</p>
              </>
            ) : (
              <p className="op-drawer-empty">Bu araca henüz bir rota atanmadı.</p>
            )}
          </div>
        </div>

        {hasRoute && (
          <div className="op-drawer-card">
            <div className="op-drawer-card-header">
              <div>
                <p className="op-kicker">Güzergah</p>
                <h3>Sıralama</h3>
              </div>
            </div>
            <div className="op-drawer-card-body op-scroll">
              <ul className="op-drawer-stop-list">
                <li>
                  <i style={{ background: color }} />
                  <span>
                    <strong>Başlangıç</strong> · araç çıkış noktası ·{' '}
                    {vehicle ? `${vehicle.start[1].toFixed(4)}, ${vehicle.start[0].toFixed(4)}` : '—'}
                  </span>
                </li>
                {routeStops.map((stop) => (
                  <li key={stop.id}>
                    <i className="op-dot-stop" />
                    <span>
                      {stop.id} · {stop.assignedPersonIds.length} kişi
                    </span>
                  </li>
                ))}
                <li>
                  <i className="op-dot-workplace" />
                  <span>
                    <strong>Varış</strong> · işyeri ·{' '}
                    {workplace ? `${workplace[1].toFixed(4)}, ${workplace[0].toFixed(4)}` : '—'}
                  </span>
                </li>
              </ul>
            </div>
          </div>
        )}
      </div>
    </>
  )
}
