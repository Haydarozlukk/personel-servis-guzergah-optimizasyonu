import { useState } from 'react'
import {
  createScenario,
  importScenarioFromExcel,
  waitForScenarioResult,
  type ExcelImportForm,
  type ScenarioAccepted,
  type ScenarioInput,
  type ScenarioResult,
} from '../lib/api'

export type ScenarioState = 'idle' | 'submitting' | 'waiting' | 'completed' | 'failed'
export type LiveStatus = 'queued' | 'running' | null

export function useScenarioSubmission() {
  const [scenarioState, setScenarioState] = useState<ScenarioState>('idle')
  const [scenarioResult, setScenarioResult] = useState<ScenarioResult | null>(null)
  const [liveStatus, setLiveStatus] = useState<LiveStatus>(null)
  const [errorMessage, setErrorMessage] = useState('')

  async function trackAcceptedScenario(requestAccepted: () => Promise<ScenarioAccepted>) {
    setScenarioState('submitting')
    setErrorMessage('')
    setScenarioResult(null)
    setLiveStatus(null)
    try {
      const accepted = await requestAccepted()
      setScenarioState('waiting')
      const result = await waitForScenarioResult(accepted.id, (update) => {
        setLiveStatus(update.status === 'queued' || update.status === 'running' ? update.status : null)
      })
      setScenarioResult(result)
      setScenarioState(result.status === 'completed' ? 'completed' : 'failed')
      if (result.status === 'failed') setErrorMessage(result.error ?? 'Senaryo başarısız oldu.')
    } catch (error) {
      setScenarioState('failed')
      setErrorMessage(error instanceof Error ? error.message : 'Senaryo gönderilemedi.')
    }
  }

  async function submitScenario(input: ScenarioInput) {
    await trackAcceptedScenario(() => createScenario(input))
  }

  async function submitExcelImport(form: ExcelImportForm) {
    await trackAcceptedScenario(() => importScenarioFromExcel(form))
  }

  return { scenarioState, scenarioResult, liveStatus, errorMessage, submitScenario, submitExcelImport }
}
