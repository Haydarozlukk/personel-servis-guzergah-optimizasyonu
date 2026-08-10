import type { ScenarioResult, ScenarioStop } from './api'
import { routeStopIds, type RouteLike } from './routeLike'

export type PersonHome = {
  id: string
  name?: string
  /// Leaflet sırası [enlem, boylam]; API [boylam, enlem] tutuyor.
  position: [number, number]
  /// Hiçbir servise atanmamışsa null.
  vehicleId: string | null
  color: string
}

export const UNASSIGNED_HOME_COLOR = '#94a3b8'

/// Personel → servis eşlemesi üç adım: rota → durak → duraktaki personel.
/// Aynı kişi birden çok durakta görünürse ilk rota kazanır (rota, sonra durak sırası).
export function buildVehicleIdByPersonId(
  routes: RouteLike[],
  stops: ScenarioStop[],
): Map<string, string> {
  const vehicleByStop = new Map<string, string>()
  for (const route of routes) {
    for (const stopId of routeStopIds(route)) {
      if (!vehicleByStop.has(stopId)) vehicleByStop.set(stopId, route.vehicleId)
    }
  }

  const vehicleByPerson = new Map<string, string>()
  for (const stop of stops) {
    const vehicleId = vehicleByStop.get(stop.id)
    if (!vehicleId) continue // Durak hiçbir rotada değil.
    for (const personId of stop.assignedPersonIds) {
      if (!vehicleByPerson.has(personId)) vehicleByPerson.set(personId, vehicleId)
    }
  }
  return vehicleByPerson
}

export function buildPersonHomes(input: {
  persons: ScenarioResult['persons']
  stops: ScenarioStop[]
  routes: RouteLike[]
  vehicleColors: Map<string, string>
  selectedVehicleId: string | null
}): PersonHome[] {
  const vehicleByPerson = buildVehicleIdByPersonId(input.routes, input.stops)
  const homes: PersonHome[] = []

  for (const person of input.persons) {
    const [longitude, latitude] = person.location ?? []
    if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) continue

    const vehicleId = vehicleByPerson.get(person.id) ?? null
    // Bir servis seçiliyken yalnızca o servisin yolcuları kalır; atanmamışlar gizlenir.
    if (input.selectedVehicleId && vehicleId !== input.selectedVehicleId) continue

    homes.push({
      id: person.id,
      name: person.name,
      position: [latitude, longitude],
      vehicleId,
      color: vehicleId
        ? input.vehicleColors.get(vehicleId) ?? UNASSIGNED_HOME_COLOR
        : UNASSIGNED_HOME_COLOR,
    })
  }

  return homes
}
