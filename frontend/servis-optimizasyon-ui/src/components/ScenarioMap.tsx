import { Circle, CircleMarker, MapContainer, Marker, Polyline, Popup, TileLayer, Tooltip } from 'react-leaflet'
import type { PersonPoint, StopCandidate } from '../mock/scenario'
import type { ScenarioStop } from '../lib/api'
import type { RouteLike } from '../lib/routeLike'
import { decodePolyline } from '../lib/polyline'
import { routeColors } from '../lib/colors'

type ScenarioMapProps = {
  routes: RouteLike[]
  persons: PersonPoint[]
  unassignedPersonIds: string[]
  realStops: ScenarioStop[] | null
  mockStops: StopCandidate[]
  workplace: [number, number]
}

export function ScenarioMap({
  routes,
  persons,
  unassignedPersonIds,
  realStops,
  mockStops,
  workplace,
}: ScenarioMapProps) {
  return (
    <section className="map-shell" aria-label="Ankara personel haritası">
      <MapContainer center={[39.9334, 32.8597]} zoom={13} scrollWheelZoom preferCanvas>
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        {routes.map((route, index) => (
          <Polyline
            key={route.vehicleId}
            positions={decodePolyline(route.geometry)}
            pathOptions={{ color: routeColors[index % routeColors.length], weight: 4, opacity: 0.85 }}
          >
            <Tooltip sticky>
              {route.vehicleId} · {(route.distanceMeters / 1000).toFixed(1)} km ·{' '}
              {Math.round(route.durationSeconds / 60)} dk · yük {route.load}
            </Tooltip>
          </Polyline>
        ))}
        {persons.map((person) => (
          <CircleMarker
            key={person.id}
            center={person.position}
            radius={7}
            pathOptions={{
              color: unassignedPersonIds.includes(person.id) ? '#dc2626' : '#216e39',
            }}
          >
            <Popup>{person.name}</Popup>
          </CircleMarker>
        ))}
        {realStops
          ? realStops.map((stop) => (
              <CircleMarker
                key={stop.id}
                center={[stop.location[1], stop.location[0]]}
                radius={10}
                pathOptions={{ color: '#cc5d00', fillColor: '#ffb703', fillOpacity: 0.9, weight: 2 }}
              >
                <Popup>
                  {stop.id} · {stop.assignedPersonIds.length} personel · ort. yürüme{' '}
                  {Math.round(stop.averageWalkingDistanceMeters)} m · kalite{' '}
                  {Math.round(stop.qualityScore * 100)}%
                </Popup>
              </CircleMarker>
            ))
          : mockStops.map((stop) => (
              <CircleMarker
                key={stop.id}
                center={stop.location}
                radius={10}
                pathOptions={{ color: '#cc5d00', fillColor: '#ffb703', fillOpacity: 0.9, weight: 2 }}
              >
                <Popup>{stop.id} · {stop.assignedPersonIds.length} personel (önizleme)</Popup>
              </CircleMarker>
            ))}
        <Marker position={workplace}>
          <Popup>İşyeri hedefi</Popup>
        </Marker>
        <Circle center={workplace} radius={500} pathOptions={{ color: '#cc5d00', fillOpacity: 0.08 }} />
      </MapContainer>
    </section>
  )
}
