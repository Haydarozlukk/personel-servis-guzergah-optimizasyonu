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
  const stops = plan.stops.map((stop) => ({
    ...stop,
    location: normalizeLngLat(stop.location),
    demand: stop.assignedPersonIds.length,
  }))
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
