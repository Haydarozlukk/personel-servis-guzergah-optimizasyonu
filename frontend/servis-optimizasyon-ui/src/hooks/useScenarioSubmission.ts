import { useState } from 'react'
import {
  fullReoptimize,
  importScenarioFromExcel,
  waitForScenarioResult,
  type ExcelImportForm,
  type ScenarioAccepted,
  type ScenarioResult,
} from '../lib/api'

export type ScenarioState = 'idle' | 'submitting' | 'waiting' | 'completed' | 'failed'
export type LiveStatus = 'queued' | 'running' | null

export function useScenarioSubmission() {
  const [scenarioState, setScenarioState] = useState<ScenarioState>('idle')
  const [scenarioResult, setScenarioResult] = useState<ScenarioResult | null>(null)
  const [liveStatus, setLiveStatus] = useState<LiveStatus>(null)
  const [errorMessage, setErrorMessage] = useState('')

  async function trackAcceptedScenario(
    requestAccepted: () => Promise<ScenarioAccepted>,
  ): Promise<ScenarioResult | null> {
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
      return result
    } catch (error) {
      setScenarioState('failed')
      setErrorMessage(error instanceof Error ? error.message : 'Senaryo gönderilemedi.')
      return null
    }
  }

  async function submitExcelImport(form: ExcelImportForm) {
    return trackAcceptedScenario(() => importScenarioFromExcel(form))
  }

  async function submitFullReoptimization(scenarioId: string, snapshotName: string, plan: ScenarioResult) {
    return trackAcceptedScenario(() => fullReoptimize(scenarioId, snapshotName, plan))
  }

  return {
    scenarioState,
    scenarioResult,
    liveStatus,
    errorMessage,
    submitExcelImport,
    submitFullReoptimization,
    replaceScenarioResult: setScenarioResult,
  }
}
