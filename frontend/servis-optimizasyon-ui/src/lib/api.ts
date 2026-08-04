// Types are derived from contracts/openapi.yaml (see `npm run generate:types`)
// rather than hand-written, so a contract change that removes/renames/retypes
// a field breaks the build here instead of failing silently at runtime.
import type { components } from './openapi'

export type Coordinate = [longitude: number, latitude: number]

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

export type ExcelImportForm = {
  file: File
  name: string
  arrivalDeadline: string
  workplaceAddress: string
  vehicleCount?: number
  vehicleCapacity?: number
}

export async function importScenarioFromExcel(form: ExcelImportForm): Promise<ScenarioAccepted> {
  const body = new FormData()
  body.set('file', form.file)
  body.set('name', form.name)
  body.set('arrivalDeadline', form.arrivalDeadline)
  body.set('workplaceAddress', form.workplaceAddress)
  if (form.vehicleCount != null) body.set('vehicleCount', String(form.vehicleCount))
  if (form.vehicleCapacity != null) body.set('vehicleCapacity', String(form.vehicleCapacity))

  const response = await fetch(`${apiBaseUrl}/api/v1/scenarios/import`, { method: 'POST', body })
  if (response.status === 413) throw new Error('Dosya boyutu sınırını aşıyor.')
  if (!response.ok) throw new Error(await parseErrorMessage(response))
  return response.json()
}

export type NewPersonInput = {
  firstName: string
  lastName: string
  location: Coordinate
}

// Not yet backed by a real endpoint — see docs/efe.md "API talepleri" for the
// proposed POST /api/v1/scenarios/{scenarioId}/persons contract. Wired up now
// so the UI flow is ready the moment Haydar ships it.
export async function addPersonsAndReoptimize(
  scenarioId: string,
  persons: NewPersonInput[],
): Promise<ScenarioAccepted> {
  const response = await fetch(`${apiBaseUrl}/api/v1/scenarios/${scenarioId}/persons`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ persons }),
  })
  if (!response.ok) throw new Error(await parseErrorMessage(response))
  return response.json()
}

export async function downloadImportTemplate(): Promise<void> {
  const response = await fetch(`${apiBaseUrl}/api/v1/scenarios/import/template`)
  if (!response.ok) throw new Error(await parseErrorMessage(response))
  const blob = await response.blob()
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = 'senaryo-sablonu.xlsx'
  link.click()
  URL.revokeObjectURL(url)
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
