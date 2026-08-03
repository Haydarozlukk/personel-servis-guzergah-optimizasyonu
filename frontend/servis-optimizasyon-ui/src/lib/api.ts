// Types are derived from contracts/openapi.yaml (see `npm run generate:types`)
// rather than hand-written, so a contract change that removes/renames/retypes
// a field breaks the build here instead of failing silently at runtime.
import type { components } from './openapi'

export type Coordinate = [longitude: number, latitude: number]

export type ScenarioInput = {
  name: string
  direction: 'morning_inbound'
  workplace: Coordinate
  arrivalDeadline: string
  persons: { id: string; location: Coordinate }[]
  vehicles: { id: string; capacity: number; start: Coordinate }[]
}

export type ScenarioAccepted = components['schemas']['ScenarioAccepted']
export type ScenarioStop = components['schemas']['Stop']
export type RouteStep = components['schemas']['RouteStep']
export type ScenarioRoute = components['schemas']['Route']
export type StopGenerationSummary = components['schemas']['StopGenerationSummary']
export type UnassignedPerson = NonNullable<components['schemas']['ScenarioResult']['unassignedPersons']>[number]
export type ScenarioResult = components['schemas']['ScenarioResult']

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
const POLL_TIMEOUT_MS = 120000

// The API persists the scenario and processes it on a background queue, so the
// GET right after the POST returns immediately with status "queued"/"running".
// Keep polling until it reaches a terminal state; also retry briefly on 404 for
// the short window between the POST response and the row actually landing.
export async function waitForScenarioResult(
  scenarioId: string,
  onUpdate?: (result: ScenarioResult) => void,
): Promise<ScenarioResult> {
  const startedAt = Date.now()
  while (true) {
    const result = await getScenarioResult(scenarioId)
    if (result) {
      onUpdate?.(result)
      if (result.status === 'completed' || result.status === 'failed') return result
    }
    if (Date.now() - startedAt > POLL_TIMEOUT_MS) {
      throw new Error('Senaryo sonucu zaman aşımına uğradı.')
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS))
  }
}
