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
      <h2>Rota detayları{isMock ? ' (mock önizleme)' : ''}</h2>
      <table>
        <thead>
          <tr>
            <th></th>
            <th>Araç</th>
            <th>Mesafe</th>
            <th>Süre</th>
            <th>Yük</th>
          </tr>
        </thead>
        <tbody>
          {routes.map((route, index) => (
            <tr key={route.vehicleId}>
              <td><span className="route-swatch" style={{ background: routeColors[index % routeColors.length] }} /></td>
              <td>{route.vehicleId}</td>
              <td>{(route.distanceMeters / 1000).toFixed(1)} km</td>
              <td>{Math.round(route.durationSeconds / 60)} dk</td>
              <td>{route.load}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  )
}
