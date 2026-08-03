export type Coordinate = [longitude: number, latitude: number]

export type ScenarioInput = {
  name: string
  direction: 'morning_inbound'
  workplace: Coordinate
  arrivalDeadline: string
  persons: { id: string; location: Coordinate }[]
  vehicles: { id: string; capacity: number; start: Coordinate }[]
}

export type ScenarioAccepted = { id: string; status: 'queued' }

export type ScenarioRoute = {
  vehicleId: string
  distanceMeters: number
  durationSeconds: number
  load: number
  geometry: string
  stopIds: string[]
}

export type StopGenerationSummary = {
  stopCount: number
  assignedPersonCount: number
  unassignedPersonCount: number
  averageWalkingDistanceMeters: number | null
  maximumWalkingDistanceMeters: number | null
  averageWalkingDurationSeconds: number | null
  maximumWalkingDurationSeconds: number | null
  matrixChunkCount: number
}

export type ScenarioResult = {
  id: string
  status: 'completed' | 'failed'
  routes: ScenarioRoute[]
  unassignedPersonIds: string[]
  stopGenerationSummary: StopGenerationSummary | null
  error: string | null
}

const apiBaseUrl = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8080'

async function parseErrorMessage(response: Response): Promise<string> {
  try {
    const body = await response.json()
    if (body?.errors) {
      return Object.values(body.errors as Record<string, string[]>).flat().join(' ')
    }
    if (body?.message) return body.message as string
  } catch {
    // response had no JSON body; fall through to the status-based message
  }
  return `İstek başarısız oldu (${response.status}).`
}

export async function createScenario(input: ScenarioInput): Promise<ScenarioAccepted> {
  const response = await fetch(`${apiBaseUrl}/api/v1/scenarios`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
  if (!response.ok) throw new Error(await parseErrorMessage(response))
  return response.json()
}

async function getScenarioResult(scenarioId: string): Promise<ScenarioResult | null> {
  const response = await fetch(`${apiBaseUrl}/api/v1/scenarios/${scenarioId}`)
  if (response.status === 404) return null
  if (!response.ok) throw new Error(await parseErrorMessage(response))
  return response.json()
}

const POLL_INTERVAL_MS = 1000
const POLL_TIMEOUT_MS = 30000

// The current API resolves the scenario synchronously before responding to the
// POST, so the GET right after should already return the stored result. This
// still retries on a 404 for the short window it takes for that write to land,
// and stays forward-compatible if the orchestrator becomes truly async later.
export async function waitForScenarioResult(scenarioId: string): Promise<ScenarioResult> {
  const startedAt = Date.now()
  while (true) {
    const result = await getScenarioResult(scenarioId)
    if (result) return result
    if (Date.now() - startedAt > POLL_TIMEOUT_MS) {
      throw new Error('Senaryo sonucu zaman aşımına uğradı.')
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS))
  }
}
