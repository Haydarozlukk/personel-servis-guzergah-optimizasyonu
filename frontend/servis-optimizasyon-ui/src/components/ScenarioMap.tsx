import { Fragment, useEffect, useMemo } from 'react'
import {
  Circle,
  CircleMarker,
  MapContainer,
  Pane,
  Polyline,
  Popup,
  TileLayer,
  Tooltip,
  ZoomControl,
  useMap,
  useMapEvents,
} from 'react-leaflet'
import type { PersonPoint } from '../lib/person'
import type { ScenarioStop, ScenarioVehicle } from '../lib/api'
import type { RouteLike } from '../lib/routeLike'
import { decodePolyline } from '../lib/polyline'
import { routeColors } from '../lib/colors'

type ScenarioMapProps = {
  routes: RouteLike[]
  pendingPersons: PersonPoint[]
  realStops: ScenarioStop[] | null
  workplace: number[] | null
  vehicles: ScenarioVehicle[]
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

// The map fills the viewport via a fixed-position full-screen container, whose
// size isn't known at Leaflet's own mount time — without this it renders at a
// stale (often tiny) initial size until the window is manually resized.
function MapResizeHandler() {
  const map = useMap()
  useEffect(() => {
    const container = map.getContainer()
    map.invalidateSize()
    const observer = new ResizeObserver(() => map.invalidateSize())
    observer.observe(container)
    return () => observer.disconnect()
  }, [map])
  return null
}

function routePositions(
  route: RouteLike,
  stopById: Map<string, ScenarioStop>,
  workplace: number[] | null,
) {
  if (route.geometry) {
    try {
      return decodePolyline(route.geometry)
    } catch {
      // Eski veya yarım kalmış bir geometri haritanın tamamını bozmasın.
    }
  }

  return (route.stopIds ?? [])
    .map((id) => stopById.get(id))
    .filter((stop): stop is ScenarioStop => !!stop)
    .map((stop) => [stop.location[1], stop.location[0]] as [number, number])
    .concat(workplace ? [[workplace[1], workplace[0]]] : [])
}

function MapBoundsHandler({ points }: { points: [number, number][] }) {
  const map = useMap()

  useEffect(() => {
    const validPoints = points.filter(([latitude, longitude]) =>
      Number.isFinite(latitude) && Number.isFinite(longitude))

    if (validPoints.length === 1) {
      map.setView(validPoints[0], 14)
    } else if (validPoints.length > 1) {
      map.fitBounds(validPoints, {
        animate: false,
        maxZoom: 14,
        padding: [56, 56],
      })
    }
  }, [map, points])

  return null
}

export function ScenarioMap({
  routes,
  pendingPersons,
  realStops,
  workplace,
  vehicles,
  pickMode = false,
  onPickLocation,
}: ScenarioMapProps) {
  const stopById = useMemo(
    () => new Map((realStops ?? []).map((stop) => [stop.id, stop])),
    [realStops],
  )
  const positionsByVehicle = useMemo(
    () => new Map(routes.map((route) => [route.vehicleId, routePositions(route, stopById, workplace)])),
    [routes, stopById, workplace],
  )
  const mapBoundsPoints = useMemo(() => {
    const routePoints = [...positionsByVehicle.values()].flat()
    if (routePoints.length > 0) return routePoints

    return [
      ...(realStops ?? []).map((stop) => [stop.location[1], stop.location[0]] as [number, number]),
      ...pendingPersons.map((person) => person.position),
      ...vehicles
        .filter((vehicle) => vehicle.start)
        .map((vehicle) => [vehicle.start![1], vehicle.start![0]] as [number, number]),
      ...(workplace ? [[workplace[1], workplace[0]] as [number, number]] : []),
    ]
  }, [pendingPersons, positionsByVehicle, realStops, vehicles, workplace])

  return (
    <div id="op-map" aria-label="Ankara personel haritası">
      <MapContainer
        center={[39.9334, 32.8597]}
        zoom={13}
        scrollWheelZoom
        preferCanvas
        zoomControl={false}
        className={pickMode ? 'picking-cursor' : undefined}
      >
        <MapResizeHandler />
        <MapBoundsHandler points={mapBoundsPoints} />
        {onPickLocation && <MapClickCatcher enabled={pickMode} onPick={onPickLocation} />}
        <ZoomControl position="bottomleft" />
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        {routes.map((route, index) => {
          const positions = positionsByVehicle.get(route.vehicleId) ?? []
          return positions.length > 1 && (
          <Polyline
            key={route.vehicleId}
            positions={positions}
            pathOptions={{ color: routeColors[index % routeColors.length], weight: 4, opacity: 0.85, dashArray: route.geometry ? undefined : '8 8' }}
          >
            <Tooltip sticky>
              {route.vehicleId} · {route.geometry
                ? `${(route.distanceMeters / 1000).toFixed(1)} km · ${Math.round(route.durationSeconds / 60)} dk`
                : 'manuel durak sırası'} · yük {route.load}
            </Tooltip>
          </Polyline>
          )
        })}
        {workplace && (
          <CircleMarker
            center={[workplace[1], workplace[0]]}
            radius={12}
            pathOptions={{ color: '#064e3b', fillColor: '#22c55e', fillOpacity: 1, weight: 3 }}
          >
            <Tooltip permanent direction="top" offset={[0, -10]}>Varış</Tooltip>
            <Popup>Kullanıcının belirlediği varış noktası</Popup>
          </CircleMarker>
        )}
        <Pane name="vehicle-starts" style={{ zIndex: 650 }}>
        {vehicles.filter((vehicle) => vehicle.start).map((vehicle, index) => (
          <CircleMarker
            key={`vehicle-start-${vehicle.id}`}
            center={[vehicle.start![1], vehicle.start![0]]}
            radius={11}
            pathOptions={{
              color: '#ffffff',
              fillColor: routeColors[index % routeColors.length],
              fillOpacity: 1,
              weight: 4,
            }}
          >
            <Tooltip>{vehicle.id} çıkış noktası</Tooltip>
            <Popup>{vehicle.id} · çıkış noktası · kapasite {vehicle.capacity}</Popup>
          </CircleMarker>
        ))}
        </Pane>
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
    </div>
  )
}
