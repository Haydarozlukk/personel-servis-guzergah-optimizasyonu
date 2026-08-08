import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import L from 'leaflet'
import {
  Circle,
  MapContainer,
  Marker,
  Pane,
  Polygon,
  Polyline,
  Popup,
  TileLayer,
  Tooltip,
  ZoomControl,
  useMap,
  useMapEvents,
} from 'react-leaflet'
import type { PersonPoint } from '../lib/person'
import { getRestrictedAreas, type ScenarioStop, type ScenarioVehicle } from '../lib/api'
import type { RouteLike } from '../lib/routeLike'
import { decodePolyline } from '../lib/polyline'
import { routeColors } from '../lib/colors'
import { getStopDisplayName } from '../lib/stopName'

type ScenarioMapProps = {
  routes: RouteLike[]
  pendingPersons: PersonPoint[]
  realStops: ScenarioStop[] | null
  workplace: number[] | null
  vehicles: ScenarioVehicle[]
  pickMode?: boolean
  focusedLocation?: number[] | null
  searchMarker?: { location: number[]; address: string } | null
  onPickLocation?: (position: [number, number]) => void
  onMoveStopLocation?: (stopId: string, location: [number, number]) => void
  onMoveVehicleStart?: (vehicleId: string, location: [number, number]) => void
}

const searchPinIcon = L.divIcon({
  className: 'op-search-pin-icon',
  html: `<svg viewBox="0 0 24 30" width="26" height="32" style="filter: drop-shadow(0 3px 4px rgba(0,0,0,.35));">
    <path d="M12 0C5.4 0 0 5.4 0 12c0 9 12 18 12 18s12-9 12-18c0-6.6-5.4-12-12-12z" fill="#2563eb"/>
    <circle cx="12" cy="12" r="4.6" fill="#fff"/>
  </svg>`,
  iconSize: [26, 32],
  iconAnchor: [13, 32],
})

const WALKING_LIMIT_METERS = 500

const createStopIcon = (color = '#ffb703', label = '') =>
  L.divIcon({
    className: 'op-stop-marker-icon',
    html: `<div style="
      width: 22px;
      height: 22px;
      border-radius: 50%;
      background: ${color};
      border: 3px solid #cc5d00;
      box-shadow: 0 2px 6px rgba(0,0,0,0.35);
      cursor: grab;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 11px;
      font-weight: 700;
      color: #000;
    ">${label}</div>`,
    iconSize: [22, 22],
    iconAnchor: [11, 11],
  })

const createVehicleStartIcon = (color = '#2563eb') =>
  L.divIcon({
    className: 'op-vehicle-start-icon',
    html: `<div style="
      width: 24px;
      height: 24px;
      border-radius: 50%;
      background: ${color};
      border: 3px solid #ffffff;
      box-shadow: 0 2px 8px rgba(0,0,0,0.4);
      cursor: grab;
    "></div>`,
    iconSize: [24, 24],
    iconAnchor: [12, 12],
  })

function MapClickCatcher({ enabled, onPick }: { enabled: boolean; onPick: (position: [number, number]) => void }) {
  useMapEvents({
    click(event) {
      if (!enabled) return
      onPick([event.latlng.lat, event.latlng.lng])
    },
  })
  return null
}

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
  const hasInitialized = useRef(false)

  useEffect(() => {
    if (hasInitialized.current) return
    const validPoints = points.filter(([latitude, longitude]) =>
      Number.isFinite(latitude) && Number.isFinite(longitude))

    if (validPoints.length === 1) {
      map.setView(validPoints[0], 14)
      hasInitialized.current = true
    } else if (validPoints.length > 1) {
      map.fitBounds(validPoints, {
        animate: false,
        maxZoom: 14,
        padding: [56, 56],
      })
      hasInitialized.current = true
    }
  }, [map, points])

  return null
}

export function toLeafletLatLng(location: number[]): [number, number] | null {
  if (!location || location.length < 2) return null
  const [a, b] = location
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null

  // In Turkey: Lat is ~35..43 (e.g. 39.9), Lng is ~25..45 (e.g. 32.8)
  if (a >= 35 && a <= 43 && b >= 25 && b <= 45) {
    return [a, b]
  }
  if (b >= 35 && b <= 43 && a >= 25 && a <= 45) {
    return [b, a]
  }
  return [a, b]
}

type RestrictedAreaShape = { id: string; name: string; rings: [number, number][][] }

/// GeoJSON halkaları [lon, lat] sırasındadır; Leaflet [lat, lng] bekler.
function useRestrictedAreas(): RestrictedAreaShape[] {
  const [areas, setAreas] = useState<RestrictedAreaShape[]>([])

  useEffect(() => {
    let cancelled = false
    getRestrictedAreas()
      .then((collection) => {
        if (cancelled) return
        setAreas(collection.features.flatMap((feature) => {
          const polygons = feature.geometry.type === 'Polygon'
            ? [feature.geometry.coordinates as number[][][]]
            : (feature.geometry.coordinates as number[][][][])
          return polygons.map((polygon) => ({
            id: feature.properties.id,
            name: feature.properties.name,
            rings: polygon.map((ring) => ring.map(([lon, lat]) => [lat, lon] as [number, number])),
          }))
        }))
      })
      .catch(() => setAreas([]))
    return () => { cancelled = true }
  }, [])

  return areas
}

function MapFlyToHandler({ location }: { location?: number[] | null }) {
  const map = useMap()
  useEffect(() => {
    if (!location) return
    const latLng = toLeafletLatLng(location)
    if (latLng) {
      map.flyTo(latLng, 15, { animate: true, duration: 1.2 })
    }
  }, [map, location])
  return null
}

export function ScenarioMap({
  routes,
  pendingPersons,
  realStops,
  workplace,
  vehicles,
  pickMode = false,
  focusedLocation,
  searchMarker,
  onPickLocation,
  onMoveStopLocation,
  onMoveVehicleStart,
}: ScenarioMapProps) {
  const restrictedAreas = useRestrictedAreas()
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
        <MapFlyToHandler location={focusedLocation} />
        {onPickLocation && <MapClickCatcher enabled={pickMode} onPick={onPickLocation} />}
        <ZoomControl position="bottomleft" />
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        {restrictedAreas.map((area) => (
          <Polygon
            key={area.id}
            positions={area.rings}
            pathOptions={{ color: '#dc2626', weight: 1.5, fillOpacity: 0.12, dashArray: '4 4' }}
          >
            <Tooltip sticky>{area.name} · servise kapalı alan</Tooltip>
          </Polygon>
        ))}
        {routes.map((route, index) => {
          const positions = positionsByVehicle.get(route.vehicleId) ?? []
          const isSelected = routes.length === 1
          const crossings = route.restrictedAreasCrossed ?? []

          return (
            positions.length > 1 && (
              <Polyline
                key={route.vehicleId}
                positions={positions}
                pathOptions={{
                  color: crossings.length > 0 ? '#dc2626' : routeColors[index % routeColors.length],
                  weight: isSelected ? 7 : 5,
                  opacity: 0.85,
                  dashArray: crossings.length > 0 ? '12 6' : route.geometry ? undefined : '8 8',
                }}
              >
                <Tooltip sticky>
                  {route.vehicleId} ·{' '}
                  {route.geometry
                    ? `${(route.distanceMeters / 1000).toFixed(1)} km · ${Math.round(route.durationSeconds / 60)} dk`
                    : 'manuel durak sırası'}
                  {crossings.length > 0 && (
                    <>
                      <br />
                      Uyarı: halka kapalı alandan geçiyor ({crossings.join(', ')})
                    </>
                  )}
                </Tooltip>
              </Polyline>
            )
          )
        })}
        {workplace && (
          <Marker
            position={[workplace[1], workplace[0]]}
            icon={L.divIcon({
              className: 'op-workplace-icon',
              html: `<div style="
                width: 26px;
                height: 26px;
                border-radius: 50%;
                background: #22c55e;
                border: 3px solid #064e3b;
                box-shadow: 0 2px 6px rgba(0,0,0,0.4);
              "></div>`,
              iconSize: [26, 26],
              iconAnchor: [13, 13],
            })}
          >
            <Tooltip permanent direction="top" offset={[0, -12]}>
              Varış
            </Tooltip>
            <Popup>Kullanıcının belirlediği varış noktası</Popup>
          </Marker>
        )}
        {searchMarker && (
          <Marker position={[searchMarker.location[1], searchMarker.location[0]]} icon={searchPinIcon}>
            <Popup>{searchMarker.address}</Popup>
          </Marker>
        )}
        <Pane name="vehicle-starts" style={{ zIndex: 650 }}>
          {vehicles
            .filter((vehicle) => vehicle.start)
            .map((vehicle, index) => (
              <Marker
                key={`vehicle-start-${vehicle.id}`}
                position={[vehicle.start![1], vehicle.start![0]]}
                draggable={!!onMoveVehicleStart}
                icon={createVehicleStartIcon(routeColors[index % routeColors.length])}
                eventHandlers={{
                  dragend(e) {
                    const latlng = e.target.getLatLng()
                    onMoveVehicleStart?.(vehicle.id, [latlng.lng, latlng.lat])
                  },
                }}
              >
                <Tooltip>{vehicle.id} çıkış noktası (Sürükleyerek taşıyabilirsiniz)</Tooltip>
                <Popup>
                  {vehicle.id} · çıkış noktası · kapasite {vehicle.capacity}
                </Popup>
              </Marker>
            ))}
        </Pane>
        {pendingPersons.map((person) => (
          <Marker
            key={person.id}
            position={person.position}
            icon={L.divIcon({
              className: 'op-pending-person-icon',
              html: `<div style="
                width: 14px;
                height: 14px;
                border-radius: 50%;
                background: #2563eb;
                border: 2px solid #ffffff;
                box-shadow: 0 1px 4px rgba(0,0,0,0.3);
              "></div>`,
              iconSize: [14, 14],
              iconAnchor: [7, 7],
            })}
          >
            <Popup>{person.name} · henüz optimize edilmedi</Popup>
          </Marker>
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
              <Marker
                position={center}
                draggable={!!onMoveStopLocation}
                icon={createStopIcon('#ffb703')}
                eventHandlers={{
                  dragend(e) {
                    const latlng = e.target.getLatLng()
                    onMoveStopLocation?.(stop.id, [latlng.lng, latlng.lat])
                  },
                }}
              >
                <Popup>
                  <strong>{getStopDisplayName(stop)}</strong> (Haritada sürükleyerek sokağını değiştirebilirsiniz)
                  <br />
                  {stop.assignedPersonIds.length} personel · ort. yürüme{' '}
                  {Math.round(stop.averageWalkingDistanceMeters)} m
                </Popup>
              </Marker>
            </Fragment>
          )
        })}
      </MapContainer>
    </div>
  )
}
