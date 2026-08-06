import { useCallback, useEffect, useState } from 'react'
import {
  activatePlanVersion,
  deletePlanVersion,
  getScenarioResult,
  listPlanVersions,
  type PlanVersion,
  type ScenarioResult,
} from '../lib/api'

export function VersionPanel({
  scenarioId,
  onClose,
  onActivated,
}: {
  scenarioId: string
  onClose: () => void
  onActivated: (plan: ScenarioResult) => void
}) {
  const [versions, setVersions] = useState<PlanVersion[]>([])
  const [error, setError] = useState('')

  const refresh = useCallback(async () => {
    try { setVersions(await listPlanVersions(scenarioId)) } catch (reason) { setError(reason instanceof Error ? reason.message : 'Versiyonlar alınamadı.') }
  }, [scenarioId])
  useEffect(() => { void refresh() }, [refresh])

  return <div className="op-admin-layer"><section className="op-admin-panel op-scroll">
    <header><div><p className="op-kicker">Plan geçmişi</p><h2>Versiyonlar</h2></div><button className="op-close" onClick={onClose}>×</button></header>
    {versions.length === 0 && <p className="op-drawer-empty">Henüz isimli versiyon kaydedilmedi.</p>}
    {versions.map((version) => <article className="op-admin-user" key={version.id}>
      <div><strong>{version.name}{version.isActive ? ' · aktif' : ''}</strong><span>{new Date(version.createdAt).toLocaleString('tr-TR')} · {version.createdBy}</span></div>
      <div>
        {!version.isActive && <button className="op-btn op-btn-primary" onClick={async () => {
          await activatePlanVersion(scenarioId, version.id)
          const plan = await getScenarioResult(scenarioId)
          if (plan) onActivated(plan)
          await refresh()
        }}>Bu versiyona dön</button>}
        <button className="op-btn op-btn-secondary" onClick={async () => {
          if (confirm(`${version.name} versiyonu silinsin mi? Mevcut çalışma korunur.`)) { await deletePlanVersion(scenarioId, version.id); await refresh() }
        }}>Sil</button>
      </div>
    </article>)}
    {error && <p className="op-error-text">{error}</p>}
  </section></div>
}
