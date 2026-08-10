// Shape shared by the mock RouteResult and the real API's ScenarioRoute; map
// and table rendering only need these fields, so components can accept either.
export type RouteLike = {
  vehicleId: string
  distanceMeters: number
  durationSeconds: number
  load: number
  geometry: string
  stopIds?: string[]
  steps?: { stopId: string }[]
  restrictedAreasCrossed?: string[]
}

// Bir rotanın durakları hem `stopIds` hem `steps[].stopId` üzerinden ifade
// edilebiliyor. Harita filtresi ile personel-servis eşlemesi aynı kümeyi görsün
// diye birleşimi tek yerde kuruyoruz.
export function routeStopIds(route: Pick<RouteLike, 'stopIds' | 'steps'>): Set<string> {
  return new Set([
    ...(route.steps?.map((step) => step.stopId) ?? []),
    ...(route.stopIds ?? []),
  ])
}
