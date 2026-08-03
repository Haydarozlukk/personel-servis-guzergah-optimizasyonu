import { Fragment, useMemo } from 'react'
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

const WALKING_LIMIT_METERS = 500

export function ScenarioMap({
  routes,
  persons,
  unassignedPersonIds,
  realStops,
  mockStops,
  workplace,
}: ScenarioMapProps) {
  // personId -> where they walk to and how far, derived from the real result.
  const personAssignment = useMemo(() => {
    const assignment = new Map<string, { stopCenter: [number, number]; distanceMeters: number }>()
    if (!realStops) return assignment
    for (const stop of realStops) {
      const stopCenter: [number, number] = [stop.location[1], stop.location[0]]
      for (const personId of stop.assignedPersonIds) {
        assignment.set(personId, {
          stopCenter,
          distanceMeters: stop.walkingDistancesMeters[personId],
        })
      }
    }
    return assignment
  }, [realStops])

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
        {persons.map((person) => {
          const assignment = personAssignment.get(person.id)
          return (
            <CircleMarker
              key={person.id}
              center={person.position}
              radius={7}
              pathOptions={{
                color: unassignedPersonIds.includes(person.id) ? '#dc2626' : '#216e39',
              }}
            >
              <Popup>
                {person.name}
                {assignment && `· yürüme mesafesi ${Math.round(assignment.distanceMeters)} m`}
              </Popup>
            </CircleMarker>
          )
        })}
        {persons.map((person) => {
          const assignment = personAssignment.get(person.id)
          if (!assignment) return null
          return (
            <Polyline
              key={`walk-${person.id}`}
              positions={[person.position, assignment.stopCenter]}
              pathOptions={{ color: '#216e39', weight: 1.5, opacity: 0.5, dashArray: '4 4' }}
            />
          )
        })}
        {realStops
          ? realStops.map((stop) => {
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
            })
          : mockStops.map((stop) => (
              <Fragment key={stop.id}>
                <Circle
                  center={stop.location}
                  radius={WALKING_LIMIT_METERS}
                  pathOptions={{ color: '#cc5d00', fillOpacity: 0.04, weight: 1 }}
                />
                <CircleMarker
                  center={stop.location}
                  radius={10}
                  pathOptions={{ color: '#cc5d00', fillColor: '#ffb703', fillOpacity: 0.9, weight: 2 }}
                >
                  <Popup>{stop.id} · {stop.assignedPersonIds.length} personel (önizleme)</Popup>
                </CircleMarker>
              </Fragment>
            ))}
        <Marker position={workplace}>
          <Popup>İşyeri hedefi</Popup>
        </Marker>
      </MapContainer>
    </section>
  )
}
