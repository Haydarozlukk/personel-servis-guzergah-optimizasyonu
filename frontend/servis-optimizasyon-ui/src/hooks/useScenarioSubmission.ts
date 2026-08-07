import { useEffect, useState } from 'react'
import {
  fullReoptimize,
  getLatestScenario,
  importAppendScenarioFromExcel,
  importScenarioFromExcel,
  saveActivePlan,
  waitForScenarioResult,
  type ExcelImportForm,
  type ScenarioAccepted,
  type ScenarioResult,
} from '../lib/api'
import { distributePersonsToPlan } from '../lib/manualPlan'

export type ScenarioState = 'idle' | 'submitting' | 'waiting' | 'completed' | 'failed'
export type LiveStatus = 'queued' | 'running' | null

export function useScenarioSubmission() {
  const [scenarioState, setScenarioState] = useState<ScenarioState>('idle')
  const [scenarioResult, setScenarioResult] = useState<ScenarioResult | null>(null)
  const [liveStatus, setLiveStatus] = useState<LiveStatus>(null)
  const [errorMessage, setErrorMessage] = useState('')

  // Auto-load the latest scenario on mount
  useEffect(() => {
    void getLatestScenario().then((result) => {
      if (result) {
        setScenarioResult(result)
        setScenarioState('completed')
      }
    }).catch(() => {
      // Silently ignore — user can still import a new scenario
    })
  }, [])

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

  async function submitExcelAppend(scenarioId: string, currentPlan: ScenarioResult, form: ExcelImportForm) {
    setScenarioState('submitting')
    setErrorMessage('')
    try {
      const res = await importAppendScenarioFromExcel(scenarioId, form)
      const distributedPlan = distributePersonsToPlan(currentPlan, res.persons)
      if (res.skippedCount > 0) {
        distributedPlan.warnings = [
          ...(distributedPlan.warnings ?? []),
          `Excel içe aktarımı: ${res.skippedCount} adres eşleştirilemediği için atlandı.`,
        ]
      }
      await saveActivePlan(scenarioId, distributedPlan)
      setScenarioResult(distributedPlan)
      setScenarioState('completed')
      return distributedPlan
    } catch (error) {
      setScenarioState('failed')
      setErrorMessage(error instanceof Error ? error.message : 'Kişiler aktarılamadı.')
      return null
    }
  }

  async function submitFullReoptimization(scenarioId: string, snapshotName: string | null | undefined, plan: ScenarioResult) {
    return trackAcceptedScenario(() => fullReoptimize(scenarioId, snapshotName, plan))
  }

  return {
    scenarioState,
    scenarioResult,
    liveStatus,
    errorMessage,
    submitExcelImport,
    submitExcelAppend,
    submitFullReoptimization,
    replaceScenarioResult: setScenarioResult,
  }
}
