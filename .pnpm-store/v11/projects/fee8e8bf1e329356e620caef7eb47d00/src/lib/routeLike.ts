// Shape shared by the mock RouteResult and the real API's ScenarioRoute; map
// and table rendering only need these fields, so components can accept either.
export type RouteLike = {
  vehicleId: string
  distanceMeters: number
  durationSeconds: number
  load: number
  geometry: string
  stopIds?: string[]
}
