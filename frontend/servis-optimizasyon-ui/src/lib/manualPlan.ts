import type { ScenarioResult, ScenarioRoute, ScenarioStop, ScenarioVehicle } from './api'

const MANUAL_WARNING = 'Plan manuel olarak düzenlendi; kullanıcı sıralaması ve atamaları esas alınır.'

function withManualWarning(plan: ScenarioResult): ScenarioResult {
  const warnings = plan.warnings?.includes(MANUAL_WARNING)
    ? plan.warnings
    : [...(plan.warnings ?? []), MANUAL_WARNING]
  return { ...plan, warnings, updatedAt: new Date().toISOString() }
}

function normalizeLngLat(location: number[]): [number, number] {
  if (location.length >= 2 && location[0] > 35 && location[1] < 35) {
    return [location[1], location[0]]
  }
  return [location[0] ?? 0, location[1] ?? 0]
}

function recalculate(plan: ScenarioResult): ScenarioResult {
  const personMap = new Map(plan.persons.map((person) => [person.id, person]))
  const stops = plan.stops.map((stop) => {
    const location = normalizeLngLat(stop.location)
    const walkingDistancesMeters: Record<string, number> = {}
    const walkingDurationsSeconds: Record<string, number> = {}
    for (const personId of stop.assignedPersonIds) {
      const person = personMap.get(personId)
      const meters = person ? Math.round(haversineDistanceMeters(person.location, location)) : 0
      walkingDistancesMeters[personId] = meters
      walkingDurationsSeconds[personId] = Math.round(meters / 1.2)
    }
    const averageWalkingDistanceMeters = stop.assignedPersonIds.length > 0
      ? Object.values(walkingDistancesMeters).reduce((sum, value) => sum + value, 0) / stop.assignedPersonIds.length
      : 0
    return {
      ...stop,
      location,
      demand: stop.assignedPersonIds.length,
      walkingDistancesMeters,
      walkingDurationsSeconds,
      averageWalkingDistanceMeters,
    }
  })
  const stopMap = new Map(stops.map((stop) => [stop.id, stop]))
  const routes = plan.routes.map((route) => {
    let load = 0
    const steps = route.stopIds.map((stopId, index) => {
      load += stopMap.get(stopId)?.assignedPersonIds.length ?? 0
      return { stopId, arrivalSeconds: route.steps[index]?.arrivalSeconds ?? 0, load }
    })
    return { ...route, load, steps }
  })
  return withManualWarning({ ...plan, stops, routes })
}

function withoutAssignment(plan: ScenarioResult, personId: string): ScenarioResult {
  const emptied = new Set<string>()
  const stops = plan.stops.map((stop) => {
    const assignedPersonIds = stop.assignedPersonIds.filter((id) => id !== personId)
    if (assignedPersonIds.length === 0) emptied.add(stop.id)
    const walkingDistancesMeters = { ...stop.walkingDistancesMeters }
    const walkingDurationsSeconds = { ...stop.walkingDurationsSeconds }
    delete walkingDistancesMeters[personId]
    delete walkingDurationsSeconds[personId]
    return { ...stop, assignedPersonIds, walkingDistancesMeters, walkingDurationsSeconds }
  }).filter((stop) => !emptied.has(stop.id))
  const routes = plan.routes.map((route) => ({
    ...route,
    ...(route.stopIds.some((id) => emptied.has(id)) ? { geometry: '', distanceMeters: 0, durationSeconds: 0 } : {}),
    stopIds: route.stopIds.filter((id) => !emptied.has(id)),
  }))
  return { ...plan, stops, routes }
}

export function unassignPerson(plan: ScenarioResult, personId: string): ScenarioResult {
  const next = withoutAssignment(plan, personId)
  const unassignedPersonIds = Array.from(new Set([...next.unassignedPersonIds, personId]))
  const unassignedPersons = [
    ...(next.unassignedPersons ?? []).filter((person) => person.id !== personId),
    { id: personId, reason: 'manual_unassigned' as const },
  ]
  return recalculate({ ...next, unassignedPersonIds, unassignedPersons })
}

/// Rotalardaki tum yolcuları tek seferde atanmamış listesine taşır; her boşalan
/// durak (ve rotası) silinir. `unassignPerson`'ı döngüde çağırmak her seferinde
/// tüm planı yeniden hesaplattığı için büyük senaryolarda yavaş kalıyordu.
export function unassignAllPersons(plan: ScenarioResult): ScenarioResult {
  const assignedPersonIds = plan.stops.flatMap((stop) => stop.assignedPersonIds)
  if (assignedPersonIds.length === 0) return plan

  const assignedIdSet = new Set(assignedPersonIds)
  const unassignedPersonIds = Array.from(new Set([...plan.unassignedPersonIds, ...assignedPersonIds]))
  const unassignedPersons = [
    ...(plan.unassignedPersons ?? []).filter((person) => !assignedIdSet.has(person.id)),
    ...assignedPersonIds.map((id) => ({ id, reason: 'manual_unassigned' as const })),
  ]
  const routes = plan.routes.map((route) => ({
    ...route,
    geometry: '',
    distanceMeters: 0,
    durationSeconds: 0,
    stopIds: [],
  }))

  return recalculate({ ...plan, stops: [], routes, unassignedPersonIds, unassignedPersons })
}

export function assignPerson(plan: ScenarioResult, personId: string, vehicleId: string): ScenarioResult {
  const person = plan.persons.find((item) => item.id === personId)
  if (!person || !vehicleHasAvailableSeat(plan, vehicleId, personId)) return plan
  let next = withoutAssignment(plan, personId)
  const baseId = `manuel-${personId}`.replace(/[^a-zA-Z0-9_-]/g, '-')
  let stopId = baseId
  let suffix = 2
  while (next.stops.some((stop) => stop.id === stopId)) stopId = `${baseId}-${suffix++}`
  const stop: ScenarioStop = {
    id: stopId,
    location: [...person.location],
    assignedPersonIds: [personId],
    walkingDistancesMeters: { [personId]: 0 },
    walkingDurationsSeconds: { [personId]: 0 },
    demand: 1,
    qualityScore: 1,
    averageWalkingDistanceMeters: 0,
  }
  const routes = next.routes.some((route) => route.vehicleId === vehicleId)
    ? next.routes.map((route) => route.vehicleId === vehicleId
      ? { ...route, geometry: '', distanceMeters: 0, durationSeconds: 0, stopIds: [...route.stopIds, stopId] }
      : route)
    : [...next.routes, emptyRoute(vehicleId, stopId)]
  next = {
    ...next,
    stops: [...next.stops, stop],
    routes,
    unassignedPersonIds: next.unassignedPersonIds.filter((id) => id !== personId),
    unassignedPersons: next.unassignedPersons?.filter((person) => person.id !== personId),
  }
  return recalculate(next)
}

export function assignPersonToStop(
  plan: ScenarioResult,
  personId: string,
  stopId: string,
): ScenarioResult {
  const targetRoute = plan.routes.find((route) => route.stopIds.includes(stopId))
  if (!plan.persons.some((person) => person.id === personId)
    || !targetRoute
    || !vehicleHasAvailableSeat(plan, targetRoute.vehicleId, personId)) return plan
  const next = withoutAssignment(plan, personId)
  return recalculate({
    ...next,
    stops: next.stops.map((stop) => stop.id === stopId
      ? {
          ...stop,
          assignedPersonIds: [...stop.assignedPersonIds, personId],
          walkingDistancesMeters: { ...stop.walkingDistancesMeters, [personId]: 0 },
          walkingDurationsSeconds: { ...stop.walkingDurationsSeconds, [personId]: 0 },
        }
      : stop),
    routes: next.routes.map((route) => route.stopIds.includes(stopId)
      ? { ...route, geometry: '', distanceMeters: 0, durationSeconds: 0 }
      : route),
    unassignedPersonIds: next.unassignedPersonIds.filter((id) => id !== personId),
    unassignedPersons: next.unassignedPersons?.filter((person) => person.id !== personId),
  })
}

export function deleteUnassignedPerson(plan: ScenarioResult, personId: string): ScenarioResult {
  if (!plan.unassignedPersonIds.includes(personId)) return plan
  return recalculate({
    ...plan,
    persons: plan.persons.filter((person) => person.id !== personId),
    unassignedPersonIds: plan.unassignedPersonIds.filter((id) => id !== personId),
    unassignedPersons: plan.unassignedPersons?.filter((person) => person.id !== personId),
  })
}

export function addUnassignedPerson(
  plan: ScenarioResult,
  person: ScenarioResult['persons'][number],
): ScenarioResult {
  return recalculate({
    ...plan,
    persons: [...plan.persons, person],
    unassignedPersonIds: [...plan.unassignedPersonIds, person.id],
    unassignedPersons: [...(plan.unassignedPersons ?? []), { id: person.id, reason: 'manual_unassigned' as const }],
  })
}

export function addVehicle(plan: ScenarioResult, vehicle: ScenarioVehicle): ScenarioResult {
  return recalculate({ ...plan, vehicles: [...plan.vehicles, vehicle] })
}

export function addVehicles(plan: ScenarioResult, vehicles: ScenarioVehicle[]): ScenarioResult {
  if (vehicles.length === 0) return plan
  return recalculate({ ...plan, vehicles: [...plan.vehicles, ...vehicles] })
}

/// Excel'den kopyalanan "İsim<TAB>Kapasite" (virgül/noktalı virgülle de olur)
/// satırlarını araç listesine dönüştürür. "18+1" gibi şoför koltuğu eklenmiş
/// kapasiteleri ilk sayıya indirger (18); aynı isim birden fazla kez geçerse
/// veya mevcut bir araç kimliğiyle çakışırsa sona "(2)", "(3)" ... eklenir.
export function parseBulkVehicleRows(
  text: string,
  existingIds: string[],
): { vehicles: ScenarioVehicle[]; errors: string[] } {
  const usedIds = new Set(existingIds)
  const vehicles: ScenarioVehicle[] = []
  const errors: string[] = []
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)

  lines.forEach((line, index) => {
    const parts = line.split(/\t|,|;/).map((part) => part.trim()).filter(Boolean)
    if (parts.length < 2) {
      errors.push(`${index + 1}. satır: isim ve kapasite ayırt edilemedi ("${line}").`)
      return
    }
    const name = parts[0]
    const capacityMatch = parts[1].match(/\d+/)
    if (!capacityMatch) {
      errors.push(`${index + 1}. satır: kapasite okunamadı ("${line}").`)
      return
    }
    const capacity = parseInt(capacityMatch[0], 10)

    let id = name
    let suffix = 2
    while (usedIds.has(id)) id = `${name} (${suffix++})`
    usedIds.add(id)

    vehicles.push({
      id,
      label: name,
      capacity,
      reservedSeats: 0,
      effectiveCapacity: capacity,
      start: null,
      plate: null,
    })
  })

  return { vehicles, errors }
}

export function moveVehicle(plan: ScenarioResult, vehicleId: string, direction: -1 | 1): ScenarioResult {
  const vehicles = [...plan.vehicles]
  const index = vehicles.findIndex((vehicle) => vehicle.id === vehicleId)
  const target = index + direction
  if (index < 0 || target < 0 || target >= vehicles.length) return plan
  ;[vehicles[index], vehicles[target]] = [vehicles[target], vehicles[index]]
  return recalculate({ ...plan, vehicles })
}

export function updateVehicle(plan: ScenarioResult, vehicleId: string, patch: Partial<ScenarioVehicle>): ScenarioResult {
  const vehicle = plan.vehicles.find((item) => item.id === vehicleId)
  if (!vehicle) return plan
  const effectiveCapacity = (patch.capacity ?? vehicle.capacity) - (patch.reservedSeats ?? vehicle.reservedSeats)
  if (assignedPersonIdsForVehicle(plan, vehicleId).length > effectiveCapacity) return plan
  return recalculate({
    ...plan,
    vehicles: plan.vehicles.map((vehicle) => vehicle.id === vehicleId
      ? { ...vehicle, ...patch, effectiveCapacity }
      : vehicle),
  })
}

export function removeVehicle(plan: ScenarioResult, vehicleId: string): ScenarioResult {
  if (plan.vehicles.length <= 1) return plan
  const route = plan.routes.find((item) => item.vehicleId === vehicleId)
  const removedStopIds = new Set(route?.stopIds ?? [])
  const affectedPeople = plan.stops
    .filter((stop) => removedStopIds.has(stop.id))
    .flatMap((stop) => stop.assignedPersonIds)
  return recalculate({
    ...plan,
    vehicles: plan.vehicles.filter((vehicle) => vehicle.id !== vehicleId),
    routes: plan.routes.filter((item) => item.vehicleId !== vehicleId),
    stops: plan.stops.filter((stop) => !removedStopIds.has(stop.id)),
    unassignedPersonIds: Array.from(new Set([...plan.unassignedPersonIds, ...affectedPeople])),
    unassignedPersons: [
      ...(plan.unassignedPersons ?? []).filter((person) => !affectedPeople.includes(person.id)),
      ...affectedPeople.map((id) => ({ id, reason: 'manual_unassigned' as const })),
    ],
  })
}

function distance(a: [number, number], b: [number, number]): number {
  const dx = a[0] - b[0]
  const dy = a[1] - b[1]
  return Math.sqrt(dx * dx + dy * dy)
}

export function findOptimalInsertionIndex(
  newLoc: [number, number],
  routeStopLocs: [number, number][],
  startLoc?: number[] | null,
  workplaceLoc?: number[] | null,
): number {
  if (routeStopLocs.length === 0) return 0

  const waypoints: { loc: [number, number]; stopIndex: number | null }[] = []
  if (startLoc && startLoc.length === 2) {
    waypoints.push({ loc: [startLoc[0], startLoc[1]], stopIndex: null })
  }
  routeStopLocs.forEach((loc, idx) => {
    waypoints.push({ loc, stopIndex: idx })
  })
  if (workplaceLoc && workplaceLoc.length === 2) {
    waypoints.push({ loc: [workplaceLoc[0], workplaceLoc[1]], stopIndex: null })
  }

  let bestInsertIndex = routeStopLocs.length
  let minExtraDist = Infinity

  for (let i = 0; i < waypoints.length - 1; i++) {
    const w1 = waypoints[i].loc
    const w2 = waypoints[i + 1].loc
    const currentDist = distance(w1, w2)
    const newDist = distance(w1, newLoc) + distance(newLoc, w2)
    const extraDist = newDist - currentDist

    if (extraDist < minExtraDist) {
      minExtraDist = extraDist
      const afterIdx = waypoints[i].stopIndex
      if (afterIdx === null) {
        bestInsertIndex = 0
      } else {
        bestInsertIndex = afterIdx + 1
      }
    }
  }

  return bestInsertIndex
}

export function addManualStop(
  plan: ScenarioResult,
  vehicleId: string,
  location: [number, number],
): ScenarioResult {
  const normalizedLoc = normalizeLngLat(location)
  const stopId = `manuel-durak-${Date.now()}`
  const stop: ScenarioStop = {
    id: stopId,
    location: normalizedLoc,
    assignedPersonIds: [],
    walkingDistancesMeters: {},
    walkingDurationsSeconds: {},
    demand: 0,
    qualityScore: 1,
    averageWalkingDistanceMeters: 0,
  }

  const stopMap = new Map(plan.stops.map((s) => [s.id, s.location]))
  const vehicle = plan.vehicles.find((v) => v.id === vehicleId)

  const routes = plan.routes.some((route) => route.vehicleId === vehicleId)
    ? plan.routes.map((route) => {
        if (route.vehicleId !== vehicleId) return route

        const existingLocs = route.stopIds
          .map((id) => stopMap.get(id))
          .filter((loc): loc is [number, number] => !!loc)

        const insertIndex = findOptimalInsertionIndex(
          normalizedLoc,
          existingLocs,
          vehicle?.start,
          plan.workplace,
        )

        const newStopIds = [...route.stopIds]
        newStopIds.splice(insertIndex, 0, stopId)

        return {
          ...route,
          geometry: '',
          distanceMeters: 0,
          durationSeconds: 0,
          stopIds: newStopIds,
        }
      })
    : [...plan.routes, emptyRoute(vehicleId, stopId)]

  return recalculate({ ...plan, stops: [...plan.stops, stop], routes })
}

export function moveStop(plan: ScenarioResult, vehicleId: string, stopId: string, direction: -1 | 1): ScenarioResult {
  const routes = plan.routes.map((route) => {
    if (route.vehicleId !== vehicleId) return route
    const stopIds = [...route.stopIds]
    const index = stopIds.indexOf(stopId)
    const target = index + direction
    if (index < 0 || target < 0 || target >= stopIds.length) return route
    ;[stopIds[index], stopIds[target]] = [stopIds[target], stopIds[index]]
    return { ...route, geometry: '', distanceMeters: 0, durationSeconds: 0, stopIds }
  })
  return recalculate({ ...plan, routes })
}

export function moveStopLocation(
  plan: ScenarioResult,
  stopId: string,
  location: [number, number],
): ScenarioResult {
  const stops = plan.stops.map((stop) =>
    stop.id === stopId ? { ...stop, location } : stop,
  )
  const routes = plan.routes.map((route) =>
    route.stopIds.includes(stopId)
      ? { ...route, geometry: '', distanceMeters: 0, durationSeconds: 0 }
      : route,
  )
  return recalculate({ ...plan, stops, routes })
}

export function moveVehicleStartLocation(
  plan: ScenarioResult,
  vehicleId: string,
  location: [number, number],
): ScenarioResult {
  return updateVehicle(plan, vehicleId, { start: location })
}

export function addViaPointOnRoute(
  plan: ScenarioResult,
  vehicleId: string,
  location: [number, number],
  insertAfterStopId?: string,
): ScenarioResult {
  const normalizedLoc = normalizeLngLat(location)
  const stopId = `gecis-noktasi-${Date.now()}`
  const viaStop: ScenarioStop = {
    id: stopId,
    location: normalizedLoc,
    assignedPersonIds: [],
    walkingDistancesMeters: {},
    walkingDurationsSeconds: {},
    demand: 0,
    qualityScore: 1,
    averageWalkingDistanceMeters: 0,
  }

  const routes = plan.routes.map((route) => {
    if (route.vehicleId !== vehicleId) return route
    const stopIds = [...route.stopIds]
    if (insertAfterStopId) {
      const idx = stopIds.indexOf(insertAfterStopId)
      if (idx >= 0) {
        stopIds.splice(idx + 1, 0, stopId)
      } else {
        stopIds.push(stopId)
      }
    } else {
      stopIds.push(stopId)
    }
    return { ...route, geometry: '', distanceMeters: 0, durationSeconds: 0, stopIds }
  })

  return recalculate({ ...plan, stops: [...plan.stops, viaStop], routes })
}

export function removeStop(plan: ScenarioResult, vehicleId: string, stopId: string): ScenarioResult {
  const route = plan.routes.find((r) => r.vehicleId === vehicleId)
  if (!route) return plan
  const stop = plan.stops.find((s) => s.id === stopId)
  if (!stop) return plan

  let next = plan
  for (const personId of stop.assignedPersonIds) {
    next = unassignPerson(next, personId)
  }

  const routes = next.routes.map((r) => {
    if (r.vehicleId !== vehicleId) return r
    const stopIds = r.stopIds.filter((id) => id !== stopId)
    return { ...r, geometry: '', distanceMeters: 0, durationSeconds: 0, stopIds }
  })

  const stops = next.stops.filter((s) => s.id !== stopId)
  return recalculate({ ...next, stops, routes })
}


function emptyRoute(vehicleId: string, stopId: string): ScenarioRoute {
  return {
    vehicleId, distanceMeters: 0, durationSeconds: 0, load: 0, geometry: '', stopIds: [stopId],
    steps: [], arrivalSeconds: 0, deadlineMet: true,
  }
}

function assignedPersonIdsForVehicle(plan: ScenarioResult, vehicleId: string): string[] {
  const route = plan.routes.find((item) => item.vehicleId === vehicleId)
  if (!route) return []
  const stops = new Map(plan.stops.map((stop) => [stop.id, stop]))
  return route.stopIds.flatMap((id) => stops.get(id)?.assignedPersonIds ?? [])
}

export type CandidateVehicle = {
  vehicleId: string
  distanceMeters: number
  availableSeats: number
}

/// Bir yolcuya en yakın, boş koltuğu olan araçları sıralar. Mesafe, aracın
/// rotasındaki en yakın durağa (rota yoksa çıkış noktasına/işyerine) göre
/// hesaplanır; "uygun servis" listesini elle atama ekranında göstermek için.
export function findCandidateVehicles(
  plan: ScenarioResult,
  personId: string,
  limit = 5,
): CandidateVehicle[] {
  const person = plan.persons.find((item) => item.id === personId)
  if (!person) return []

  const stopMap = new Map(plan.stops.map((stop) => [stop.id, stop]))
  const candidates: CandidateVehicle[] = []

  for (const vehicle of plan.vehicles) {
    if (!vehicleHasAvailableSeat(plan, vehicle.id)) continue
    const assigned = assignedPersonIdsForVehicle(plan, vehicle.id).length
    const availableSeats = vehicle.effectiveCapacity - assigned

    const route = plan.routes.find((item) => item.vehicleId === vehicle.id)
    const stopLocations = (route?.stopIds ?? [])
      .map((id) => stopMap.get(id)?.location)
      .filter((loc): loc is number[] => !!loc)
    const referenceLocations = stopLocations.length > 0
      ? stopLocations
      : [vehicle.start ?? plan.workplace].filter((loc): loc is number[] => !!loc)

    if (referenceLocations.length === 0) continue
    const distanceMeters = Math.min(
      ...referenceLocations.map((loc) => haversineDistanceMeters(person.location, loc)),
    )
    candidates.push({ vehicleId: vehicle.id, distanceMeters, availableSeats })
  }

  return candidates.sort((a, b) => a.distanceMeters - b.distanceMeters).slice(0, limit)
}

export function vehicleHasAvailableSeat(
  plan: ScenarioResult,
  vehicleId: string,
  excludingPersonId?: string,
): boolean {
  const vehicle = plan.vehicles.find((item) => item.id === vehicleId)
  if (!vehicle) return false
  const assigned = assignedPersonIdsForVehicle(plan, vehicleId)
    .filter((personId) => personId !== excludingPersonId)
  return assigned.length < vehicle.effectiveCapacity
}

export function haversineDistanceMeters(loc1: number[], loc2: number[]): number {
  const [lng1, lat1] = normalizeLngLat(loc1)
  const [lng2, lat2] = normalizeLngLat(loc2)
  const R = 6371000
  const dLat = ((lat2 - lat1) * Math.PI) / 180
  const dLng = ((lng2 - lng1) * Math.PI) / 180
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) * Math.sin(dLng / 2)
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
  return R * c
}

export function findOptimalStopOrder(
  stopLocations: Array<{ id: string; location: number[] }>,
  startLoc: number[] | null,
  workplaceLoc: number[] | null,
): string[] {
  if (stopLocations.length <= 1) return stopLocations.map((s) => s.id)

  const start = startLoc ? normalizeLngLat(startLoc) : null
  const workplace = workplaceLoc ? normalizeLngLat(workplaceLoc) : null

  const unvisited = [...stopLocations]
  const orderedIds: string[] = []

  let currentLoc = start ?? normalizeLngLat(unvisited[0].location)

  while (unvisited.length > 0) {
    let nearestIndex = 0
    let minDistance = Infinity

    for (let i = 0; i < unvisited.length; i++) {
      const dist = haversineDistanceMeters(currentLoc, unvisited[i].location)
      if (dist < minDistance) {
        minDistance = dist
        nearestIndex = i
      }
    }

    const nextStop = unvisited.splice(nearestIndex, 1)[0]
    orderedIds.push(nextStop.id)
    currentLoc = normalizeLngLat(nextStop.location)
  }

  if (orderedIds.length >= 3 && orderedIds.length <= 40) {
    const stopMap = new Map(stopLocations.map((s) => [s.id, s]))
    let improved = true
    let passes = 0

    const calcTotalDist = (ids: string[]) => {
      let total = 0
      let prev = start
      for (const id of ids) {
        const loc = stopMap.get(id)?.location
        if (loc) {
          if (prev) total += haversineDistanceMeters(prev, loc)
          prev = normalizeLngLat(loc)
        }
      }
      if (prev && workplace) total += haversineDistanceMeters(prev, workplace)
      return total
    }

    let bestDist = calcTotalDist(orderedIds)

    while (improved && passes < 10) {
      improved = false
      passes++
      for (let i = 0; i < orderedIds.length - 1; i++) {
        for (let k = i + 1; k < orderedIds.length; k++) {
          const newIds = [
            ...orderedIds.slice(0, i),
            ...orderedIds.slice(i, k + 1).reverse(),
            ...orderedIds.slice(k + 1),
          ]
          const newDist = calcTotalDist(newIds)
          if (newDist < bestDist - 1) {
            orderedIds.splice(0, orderedIds.length, ...newIds)
            bestDist = newDist
            improved = true
          }
        }
      }
    }
  }

  return orderedIds
}

export function distributePersonsToPlan(
  plan: ScenarioResult,
  newPersons: Array<{ id: string; name: string; address: string; location: number[] }>,
): ScenarioResult {
  const updatedPlan: ScenarioResult = { ...plan }

  const stops = [...updatedPlan.stops]
  const routes = [...updatedPlan.routes]
  const persons = [...updatedPlan.persons]
  const unassignedPersonIds = [...updatedPlan.unassignedPersonIds]
  const unassignedPersons = [...(updatedPlan.unassignedPersons ?? [])]

  const vehiclePassengerCount = new Map<string, number>()
  for (const v of updatedPlan.vehicles) {
    let count = 0
    for (const r of routes) {
      if (r.vehicleId === v.id) {
        for (const stopId of r.stopIds) {
          const s = stops.find((item) => item.id === stopId)
          if (s) count += s.assignedPersonIds.length
        }
      }
    }
    vehiclePassengerCount.set(v.id, count)
  }

  for (const p of newPersons) {
    let pId = p.id
    if (persons.some((item) => item.id === pId)) {
      pId = `${p.id}-${Math.floor(Math.random() * 1000)}`
    }
    const personObj = {
      id: pId,
      name: p.name || 'Personel',
      address: p.address || '',
      location: [...p.location],
    }
    persons.push(personObj)

    let bestDistance = Infinity
    let bestStopId: string | null = null
    let bestVehicleId: string | null = null

    for (const v of updatedPlan.vehicles) {
      const currentLoad = vehiclePassengerCount.get(v.id) ?? 0
      if (currentLoad >= v.effectiveCapacity) continue

      const route = routes.find((r) => r.vehicleId === v.id)
      if (!route) continue

      for (const stopId of route.stopIds) {
        const s = stops.find((item) => item.id === stopId)
        if (!s) continue

        const dist = haversineDistanceMeters(p.location, s.location)
        if (dist < bestDistance) {
          bestDistance = dist
          bestStopId = stopId
          bestVehicleId = v.id
        }
      }
    }

    if (bestStopId && bestVehicleId && bestDistance <= 800) {
      const stopIndex = stops.findIndex((s) => s.id === bestStopId)
      if (stopIndex !== -1) {
        const existingStop = stops[stopIndex]
        stops[stopIndex] = {
          ...existingStop,
          assignedPersonIds: [...existingStop.assignedPersonIds, pId],
          walkingDistancesMeters: { ...existingStop.walkingDistancesMeters, [pId]: Math.round(bestDistance) },
          walkingDurationsSeconds: { ...existingStop.walkingDurationsSeconds, [pId]: Math.round(bestDistance / 1.2) },
        }
        vehiclePassengerCount.set(bestVehicleId, (vehiclePassengerCount.get(bestVehicleId) ?? 0) + 1)
        continue
      }
    }

    let bestVehicleForNewStop: string | null = null
    let minVehicleDist = Infinity

    for (const v of updatedPlan.vehicles) {
      const currentLoad = vehiclePassengerCount.get(v.id) ?? 0
      if (currentLoad >= v.effectiveCapacity) continue

      const route = routes.find((r) => r.vehicleId === v.id)
      if (!route) continue

      for (const stopId of route.stopIds) {
        const s = stops.find((item) => item.id === stopId)
        if (!s) continue
        const dist = haversineDistanceMeters(p.location, s.location)
        if (dist < minVehicleDist) {
          minVehicleDist = dist
          bestVehicleForNewStop = v.id
        }
      }
    }

    if (bestVehicleForNewStop) {
      const routeIndex = routes.findIndex((r) => r.vehicleId === bestVehicleForNewStop)
      if (routeIndex !== -1) {
        const route = routes[routeIndex]
        const newStopId = `stop-excel-${pId}`
        const newStop: ScenarioStop = {
          id: newStopId,
          location: [...p.location],
          assignedPersonIds: [pId],
          walkingDistancesMeters: { [pId]: 0 },
          walkingDurationsSeconds: { [pId]: 0 },
          demand: 1,
          qualityScore: 1,
          averageWalkingDistanceMeters: 0,
        }
        stops.push(newStop)
        routes[routeIndex] = {
          ...route,
          stopIds: [...route.stopIds, newStopId],
          geometry: '',
          distanceMeters: 0,
          durationSeconds: 0,
        }
        vehiclePassengerCount.set(bestVehicleForNewStop, (vehiclePassengerCount.get(bestVehicleForNewStop) ?? 0) + 1)
        continue
      }
    }

    unassignedPersonIds.push(pId)
    unassignedPersons.push({ id: pId, reason: 'stop_capacity_full' as const })
  }

  // Optimize stop order on every route via TSP 2-Opt to ensure no zigzags
  const optimizedRoutes = routes.map((route) => {
    const routeStops = route.stopIds
      .map((id) => stops.find((s) => s.id === id))
      .filter((s): s is ScenarioStop => Boolean(s))
    // Baslangic noktasi acik: aracin sabit bir deposu yok, ilk durak baslangic
    // noktasi kabul edilir (vehicle.start eski sozlesme icin varis koordinatini
    // tasir, gercek bir depo degildir - buraya anchor olarak verilmemeli).
    const optimizedStopIds = findOptimalStopOrder(
      routeStops,
      null,
      updatedPlan.workplace ?? null,
    )
    const orderChanged = optimizedStopIds.some((id, idx) => id !== route.stopIds[idx])
    return {
      ...route,
      stopIds: optimizedStopIds,
      ...(orderChanged || !route.geometry ? { geometry: '', distanceMeters: 0, durationSeconds: 0 } : {}),
    }
  })

  const result: ScenarioResult = {
    ...updatedPlan,
    persons,
    stops,
    routes: optimizedRoutes,
    unassignedPersonIds,
    unassignedPersons,
    updatedAt: new Date().toISOString(),
  }

  return recalculate(result)
}
