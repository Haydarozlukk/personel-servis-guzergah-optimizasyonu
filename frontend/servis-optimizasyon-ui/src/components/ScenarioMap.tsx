import { Fragment } from 'react'
import { Circle, CircleMarker, MapContainer, Polyline, Popup, TileLayer, Tooltip, useMapEvents } from 'react-leaflet'
import type { PersonPoint } from '../lib/person'
import type { ScenarioStop } from '../lib/api'
import type { RouteLike } from '../lib/routeLike'
import { decodePolyline } from '../lib/polyline'
import { routeColors } from '../lib/colors'

type ScenarioMapProps = {
  routes: RouteLike[]
  pendingPersons: PersonPoint[]
  realStops: ScenarioStop[] | null
  pickMode?: boolean
  onPickLocation?: (position: [number, number]) => void
}

const WALKING_LIMIT_METERS = 500

function MapClickCatcher({ enabled, onPick }: { enabled: boolean; onPick: (position: [number, number]) => void }) {
  useMapEvents({
    click(event) {
      if (!enabled) return
      onPick([event.latlng.lat, event.latlng.lng])
    },
  })
  return null
}

export function ScenarioMap({
  routes,
  pendingPersons,
  realStops,
  pickMode = false,
  onPickLocation,
}: ScenarioMapProps) {
  return (
    <section className={`map-shell${pickMode ? ' picking' : ''}`} aria-label="Ankara personel haritası">
      <MapContainer
        center={[39.9334, 32.8597]}
        zoom={13}
        scrollWheelZoom
        preferCanvas
        className={pickMode ? 'picking-cursor' : undefined}
      >
        {onPickLocation && <MapClickCatcher enabled={pickMode} onPick={onPickLocation} />}
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
        {pendingPersons.map((person) => (
          <CircleMarker key={person.id} center={person.position} radius={7} pathOptions={{ color: '#2563eb' }}>
            <Popup>{person.name} · henüz optimize edilmedi</Popup>
          </CircleMarker>
        ))}
        {realStops?.map((stop) => {
          const center: [number, number] = [stop.location[1], stop.location[0]]
          return (
            <Fragment key={stop.id}>
              <Circle
                center={center}
                radius={WALKING_LIMIT_METERS}
                pathOptions={{ color: '#cc5d00', fillOpacity: 0.04, weight: 1 }}
              />
              <CircleMarker
                center={center}
                radius={10}
                pathOptions={{ color: '#cc5d00', fillColor: '#ffb703', fillOpacity: 0.9, weight: 2 }}
              >
                <Popup>
                  {stop.id} · {stop.assignedPersonIds.length} personel · ort. yürüme{' '}
                  {Math.round(stop.averageWalkingDistanceMeters)} m · kalite{' '}
                  {Math.round(stop.qualityScore * 100)}%
                </Popup>
              </CircleMarker>
            </Fragment>
          )
        })}
      </MapContainer>
    </section>
  )
}
