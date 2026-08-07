import { useCallback, useEffect, useState } from 'react'
import {
  activatePlanVersion,
  deletePlanVersion,
  getScenarioResult,
  listPlanVersions,
  savePlanVersion,
  type PlanVersion,
  type ScenarioResult,
} from '../lib/api'

export function VersionPanel({
  scenarioId,
  plan,
  onClose,
  onActivated,
}: {
  scenarioId: string
  plan: ScenarioResult
  onClose: () => void
  onActivated: (plan: ScenarioResult) => void
}) {
  const [versions, setVersions] = useState<PlanVersion[]>([])
  const [error, setError] = useState('')
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [saving, setSaving] = useState(false)

  const refresh = useCallback(async () => {
    try { setVersions(await listPlanVersions(scenarioId)) } catch (reason) { setError(reason instanceof Error ? reason.message : 'Versiyonlar alınamadı.') }
  }, [scenarioId])
  useEffect(() => { void refresh() }, [refresh])

  async function handleSave() {
    const trimmed = name.trim()
    if (!trimmed || saving) return
    setSaving(true)
    setError('')
    try {
      await savePlanVersion(scenarioId, trimmed, description.trim(), plan)
      setName('')
      setDescription('')
      await refresh()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Versiyon kaydedilemedi.')
    } finally {
      setSaving(false)
    }
  }

  return <div className="op-admin-layer"><section className="op-admin-panel op-scroll">
    <header><div><p className="op-kicker">Plan geçmişi</p><h2>Versiyonlar</h2></div><button className="op-close" onClick={onClose}>×</button></header>
    {versions.length === 0 && <p className="op-drawer-empty">Henüz isimli versiyon kaydedilmedi.</p>}
    {versions.map((version) => <article className="op-admin-user" key={version.id}>
      <div><strong>{version.name}{version.isActive ? ' · aktif' : ''}</strong><span>{new Date(version.createdAt).toLocaleString('tr-TR')} · {version.createdBy}</span></div>
      <div>
        {!version.isActive && <button className="op-btn op-btn-primary" onClick={async () => {
          await activatePlanVersion(scenarioId, version.id)
          const activated = await getScenarioResult(scenarioId)
          if (activated) onActivated(activated)
          await refresh()
        }}>Bu versiyona dön</button>}
        <button className="op-btn op-btn-secondary" onClick={async () => {
          if (confirm(`${version.name} versiyonu silinsin mi? Mevcut çalışma korunur.`)) { await deletePlanVersion(scenarioId, version.id); await refresh() }
        }}>Sil</button>
      </div>
    </article>)}
    <div className="op-version-save">
      <p className="op-kicker">Yeni versiyon olarak kaydet</p>
      <div className="op-admin-form">
        <label>
          <span>Versiyon adı</span>
          <input type="text" value={name} onChange={(event) => setName(event.target.value)} placeholder="örn. Ekim planı v2" />
        </label>
        <label>
          <span>Açıklama (opsiyonel)</span>
          <input type="text" value={description} onChange={(event) => setDescription(event.target.value)} />
        </label>
        <button type="button" className="op-btn op-btn-primary" disabled={!name.trim() || saving} onClick={() => void handleSave()}>
          {saving ? 'Kaydediliyor…' : 'Kaydet'}
        </button>
      </div>
    </div>
    {error && <p className="op-error-text">{error}</p>}
  </section></div>
}
