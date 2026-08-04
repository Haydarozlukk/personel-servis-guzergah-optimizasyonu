import type { RouteLike } from '../lib/routeLike'
import { routeColors } from '../lib/colors'

type RouteTableProps = {
  routes: RouteLike[]
  isMock: boolean
}

export function RouteTable({ routes, isMock }: RouteTableProps) {
  if (routes.length === 0) return null

  return (
    <section className="route-table" aria-label="Rota detayları">
      <div className="result-card-header">
        <div>
          <p className="section-kicker">Araç dağılımı</p>
          <h2>Rota detayları</h2>
          <span>{isMock ? 'Optimizasyon öncesi örnek dağılım' : 'Optimizasyon sonucu araç planı'}</span>
        </div>
        <strong>{routes.length} rota</strong>
      </div>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th aria-label="Rota rengi"></th>
              <th>Araç</th>
              <th>Mesafe</th>
              <th>Süre</th>
              <th>Yolcu</th>
            </tr>
          </thead>
          <tbody>
            {routes.map((route, index) => (
              <tr key={route.vehicleId}>
                <td><span aria-hidden="true" className="route-swatch" style={{ background: routeColors[index % routeColors.length] }} /></td>
                <td><strong>{route.vehicleId}</strong></td>
                <td>{(route.distanceMeters / 1000).toFixed(1)} km</td>
                <td>{Math.round(route.durationSeconds / 60)} dk</td>
                <td><span className="load-chip">{route.load} kişi</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}
