import { encodePolyline } from '../lib/polyline'

export type PersonPoint = { id: string; name: string; position: [number, number] }

export type StopCandidate = {
  id: string
  location: [number, number]
  assignedPersonIds: string[]
}

export type RouteResult = {
  vehicleId: string
  distanceMeters: number
  durationSeconds: number
  load: number
  geometry: string
}

export const mockWorkplace: [number, number] = [39.9208, 32.8541]

const AVERAGE_VEHICLE_SPEED_KMH = 28

export function createMockPersons(count: number): PersonPoint[] {
  return Array.from({ length: count }, (_, index) => {
    const angle = index * 2.39996
    const radius = 0.004 + (index % 7) * 0.0012
    return {
      id: `person-${String(index + 1).padStart(3, '0')}`,
      name: `Personel ${String(index + 1).padStart(3, '0')}`,
      position: [
        mockWorkplace[0] + Math.cos(angle) * radius,
        mockWorkplace[1] + Math.sin(angle) * radius,
      ],
    }
  })
}

// Groups nearby persons (by generation order, which is already angle-sorted)
// into walking-distance stop candidates. Mirrors the shape of
// StopGenerationResult in contracts/openapi.yaml so this slots in once
// Kerim's /api/v1/stops/generate is live.
export function createMockStops(persons: PersonPoint[], clusterSize = 5): StopCandidate[] {
  const stops: StopCandidate[] = []
  for (let index = 0; index < persons.length; index += clusterSize) {
    const cluster = persons.slice(index, index + clusterSize)
    stops.push({
      id: `stop-${String(stops.length + 1).padStart(3, '0')}`,
      location: [
        cluster.reduce((sum, person) => sum + person.position[0], 0) / cluster.length,
        cluster.reduce((sum, person) => sum + person.position[1], 0) / cluster.length,
      ],
      assignedPersonIds: cluster.map((person) => person.id),
    })
  }
  return stops
}

function haversineMeters(a: [number, number], b: [number, number]): number {
  const earthRadiusMeters = 6371000
  const toRad = (deg: number) => (deg * Math.PI) / 180
  const dLat = toRad(b[0] - a[0])
  const dLng = toRad(b[1] - a[1])
  const sinDLat = Math.sin(dLat / 2)
  const sinDLng = Math.sin(dLng / 2)
  const h = sinDLat * sinDLat + Math.cos(toRad(a[0])) * Math.cos(toRad(b[0])) * sinDLng * sinDLng
  return 2 * earthRadiusMeters * Math.asin(Math.sqrt(h))
}

// Distributes stops round-robin across vehicles and builds a workplace ->
// stops -> workplace loop per vehicle, encoded the same way ScenarioResult's
// route.geometry is documented (encoded polyline), so the map draws it via
// the same decoder a real backend response would use.
export function createMockRoutes(
  stops: StopCandidate[],
  vehicleCount: number,
  workplace: [number, number],
): RouteResult[] {
  if (stops.length === 0 || vehicleCount <= 0) return []

  const paths: [number, number][][] = Array.from({ length: vehicleCount }, () => [workplace])
  const loads = new Array(vehicleCount).fill(0)

  stops.forEach((stop, index) => {
    const vehicleIndex = index % vehicleCount
    paths[vehicleIndex].push(stop.location)
    loads[vehicleIndex] += stop.assignedPersonIds.length
  })

  return paths
    .map((path, index) => {
      if (path.length < 2) return null
      const fullPath = [...path, workplace]
      let distanceMeters = 0
      for (let i = 1; i < fullPath.length; i++) {
        distanceMeters += haversineMeters(fullPath[i - 1], fullPath[i])
      }
      return {
        vehicleId: `vehicle-${String(index + 1).padStart(3, '0')}`,
        distanceMeters: Math.round(distanceMeters),
        durationSeconds: Math.round((distanceMeters / 1000 / AVERAGE_VEHICLE_SPEED_KMH) * 3600),
        load: loads[index],
        geometry: encodePolyline(fullPath),
      }
    })
    .filter((route): route is RouteResult => route !== null)
}
