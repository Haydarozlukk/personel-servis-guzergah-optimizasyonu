// Types are derived from contracts/openapi.yaml (see `npm run generate:types`)
// rather than hand-written, so a contract change that removes/renames/retypes
// a field breaks the build here instead of failing silently at runtime.
import type { components } from './openapi'

export type Coordinate = [longitude: number, latitude: number]

export type ScenarioAccepted = components['schemas']['ScenarioAccepted']
export type ScenarioStop = components['schemas']['Stop']
export type ScenarioVehicle = components['schemas']['Vehicle']
export type RouteStep = components['schemas']['RouteStep']
export type ScenarioRoute = components['schemas']['Route']
export type StopGenerationSummary = components['schemas']['StopGenerationSummary']
export type UnassignedPerson = NonNullable<components['schemas']['ScenarioResult']['unassignedPersons']>[number]
export type ScenarioResult = components['schemas']['ScenarioResult']

export type CurrentUser = {
  id: string
  email: string
  displayName: string
  role: 'admin' | 'expert'
  status: 'pending' | 'approved' | 'deleted'
  createdAt: string
  updatedAt: string
}

export type PlanVersion = {
  id: string
  name: string
  description?: string | null
  createdBy: string
  createdAt: string
  isActive: boolean
}

export type NearbyService = {
  vehicleId: string
  distanceMeters: number
  nearestStopId?: string | null
  load: number
  effectiveCapacity: number
}

export type NearbyServicesResponse = {
  address: string
  location: Coordinate
  services: NearbyService[]
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

export type ExcelImportForm = {
  file: File
  name: string
  arrivalDeadline: string
  destinationAddress?: string
}

export async function importScenarioFromExcel(form: ExcelImportForm): Promise<ScenarioAccepted> {
  const body = new FormData()
  body.set('file', form.file)
  body.set('name', form.name)
  body.set('arrivalDeadline', form.arrivalDeadline)
  if (form.destinationAddress) body.set('destinationAddress', form.destinationAddress)

  const response = await fetch(`${apiBaseUrl}/api/v1/scenarios/import`, { method: 'POST', body, credentials: 'include' })
  if (response.status === 413) throw new Error('Dosya boyutu sınırını aşıyor.')
  if (!response.ok) throw new Error(await parseErrorMessage(response))
  return response.json()
}

export async function downloadImportTemplate(): Promise<void> {
  const response = await fetch(`${apiBaseUrl}/api/v1/scenarios/import/template`, { credentials: 'include' })
  if (!response.ok) throw new Error(await parseErrorMessage(response))
  const blob = await response.blob()
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = 'senaryo-sablonu.xlsx'
  link.click()
  URL.revokeObjectURL(url)
}

export async function getScenarioResult(scenarioId: string): Promise<ScenarioResult | null> {
  const response = await fetch(`${apiBaseUrl}/api/v1/scenarios/${scenarioId}`, { credentials: 'include' })
  if (response.status === 404) return null
  if (!response.ok) throw new Error(await parseErrorMessage(response))
  return response.json()
}

export async function getLatestScenario(): Promise<ScenarioResult | null> {
  const response = await fetch(`${apiBaseUrl}/api/v1/scenarios/latest`, { credentials: 'include' })
  if (response.status === 404) return null
  if (!response.ok) throw new Error(await parseErrorMessage(response))
  return response.json()
}

export async function getCurrentUser(): Promise<CurrentUser | null> {
  const response = await fetch(`${apiBaseUrl}/api/v1/auth/me`, { credentials: 'include' })
  if (response.status === 401) return null
  if (!response.ok) throw new Error(await parseErrorMessage(response))
  return response.json()
}

export async function login(email: string, password: string): Promise<CurrentUser> {
  const response = await fetch(`${apiBaseUrl}/api/v1/auth/login`, {
    method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  })
  if (!response.ok) throw new Error(await parseErrorMessage(response))
  return response.json()
}

export async function register(email: string, displayName: string, password: string): Promise<CurrentUser> {
  const response = await fetch(`${apiBaseUrl}/api/v1/auth/register`, {
    method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, displayName, password }),
  })
  if (!response.ok) throw new Error(await parseErrorMessage(response))
  return response.json()
}

export async function logout(): Promise<void> {
  const response = await fetch(`${apiBaseUrl}/api/v1/auth/logout`, { method: 'POST', credentials: 'include' })
  if (!response.ok) throw new Error(await parseErrorMessage(response))
}

export async function listUsers(): Promise<CurrentUser[]> {
  const response = await fetch(`${apiBaseUrl}/api/v1/admin/users`, { credentials: 'include' })
  if (!response.ok) throw new Error(await parseErrorMessage(response))
  return response.json()
}

export async function adminAddUser(email: string, displayName: string, password: string, role: string = 'expert'): Promise<CurrentUser> {
  const response = await fetch(`${apiBaseUrl}/api/v1/admin/users`, {
    method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, displayName, password, role }),
  })
  if (!response.ok) throw new Error(await parseErrorMessage(response))
  return response.json()
}

export async function approveUser(id: string): Promise<void> {
  const response = await fetch(`${apiBaseUrl}/api/v1/admin/users/${id}/approve`, { method: 'POST', credentials: 'include' })
  if (!response.ok) throw new Error(await parseErrorMessage(response))
}

export async function deleteUser(id: string): Promise<void> {
  const response = await fetch(`${apiBaseUrl}/api/v1/admin/users/${id}`, { method: 'DELETE', credentials: 'include' })
  if (!response.ok) throw new Error(await parseErrorMessage(response))
}

export async function savePlanVersion(
  scenarioId: string, name: string, description: string, plan: ScenarioResult,
): Promise<PlanVersion> {
  const response = await fetch(`${apiBaseUrl}/api/v1/scenarios/${scenarioId}/versions`, {
    method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, description: description || null, plan }),
  })
  if (!response.ok) throw new Error(await parseErrorMessage(response))
  return response.json()
}

export async function saveActivePlan(scenarioId: string, plan: ScenarioResult): Promise<ScenarioResult> {
  const response = await fetch(`${apiBaseUrl}/api/v1/scenarios/${scenarioId}/active-plan`, {
    method: 'PUT', credentials: 'include', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(plan),
  })
  if (!response.ok) throw new Error(await parseErrorMessage(response))
  return response.json()
}

export async function fullReoptimize(
  scenarioId: string,
  snapshotName: string | null | undefined,
  plan: ScenarioResult,
): Promise<ScenarioAccepted> {
  const response = await fetch(`${apiBaseUrl}/api/v1/scenarios/${scenarioId}/full-reoptimize`, {
    method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ snapshotName: snapshotName ?? null, plan }),
  })
  if (!response.ok) throw new Error(await parseErrorMessage(response))
  return response.json()
}

export async function listPlanVersions(scenarioId: string): Promise<PlanVersion[]> {
  const response = await fetch(`${apiBaseUrl}/api/v1/scenarios/${scenarioId}/versions`, { credentials: 'include' })
  if (!response.ok) throw new Error(await parseErrorMessage(response))
  return response.json()
}

export async function activatePlanVersion(scenarioId: string, versionId: string): Promise<void> {
  const response = await fetch(`${apiBaseUrl}/api/v1/scenarios/${scenarioId}/versions/${versionId}/activate`, {
    method: 'POST', credentials: 'include',
  })
  if (!response.ok) throw new Error(await parseErrorMessage(response))
}

export async function deletePlanVersion(scenarioId: string, versionId: string): Promise<void> {
  const response = await fetch(`${apiBaseUrl}/api/v1/scenarios/${scenarioId}/versions/${versionId}`, {
    method: 'DELETE', credentials: 'include',
  })
  if (!response.ok) throw new Error(await parseErrorMessage(response))
}

export async function downloadPlanExport(scenarioId: string): Promise<void> {
  const response = await fetch(`${apiBaseUrl}/api/v1/scenarios/${scenarioId}/export`, { credentials: 'include' })
  if (!response.ok) throw new Error(await parseErrorMessage(response))
  const blob = await response.blob()
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `${scenarioId}-servis-plani.zip`
  link.click()
  URL.revokeObjectURL(url)
}

export async function findNearbyServices(scenarioId: string, address: string): Promise<NearbyServicesResponse> {
  const query = new URLSearchParams({ address })
  const response = await fetch(`${apiBaseUrl}/api/v1/scenarios/${scenarioId}/nearby-services?${query}`, { credentials: 'include' })
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
