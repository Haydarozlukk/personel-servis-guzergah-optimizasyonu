import { useState } from 'react'
import type { PersonPoint } from './lib/person'
import type { NewPersonInput } from './lib/api'
import { useScenarioSubmission } from './hooks/useScenarioSubmission'
import { ExcelImportForm } from './components/ExcelImportForm'
import { ScenarioMap } from './components/ScenarioMap'
import { AddPersonPanel, type PendingPerson } from './components/AddPersonPanel'
import { RouteTable } from './components/RouteTable'
import { UnassignedList } from './components/UnassignedList'

const unassignedReasonLabels: Record<string, string> = {
  no_candidate_within_limit: '500 m içinde durak yok',
  no_route: 'yürüme rotası yok',
  stop_capacity_full: 'durak kapasitesi doldu',
  not_routed: 'araç kapasitesi yetersiz',
}

export function App() {
  const [pendingPersons, setPendingPersons] = useState<PendingPerson[]>([])
  const [isPicking, setIsPicking] = useState(false)
  const [draftLocation, setDraftLocation] = useState<[number, number] | null>(null)
  const { scenarioState, scenarioResult, liveStatus, errorMessage, submitExcelImport, submitNewPersons } =
    useScenarioSubmission()

  const isBusy = scenarioState === 'submitting' || scenarioState === 'waiting'

  function handleTogglePicking() {
    setDraftLocation(null)
    setIsPicking((prev) => !prev)
  }

  function handleMapPick(position: [number, number]) {
    if (draftLocation) return
    setDraftLocation(position)
  }

  function handleConfirmDraft(firstName: string, lastName: string) {
    if (!draftLocation) return
    setPendingPersons((prev) => [
      ...prev,
      {
        id: `manual-${String(prev.length + 1).padStart(3, '0')}`,
        name: `${firstName} ${lastName}`,
        firstName,
        lastName,
        position: draftLocation,
      },
    ])
    setDraftLocation(null)
  }

  function handleCancelDraft() {
    setDraftLocation(null)
  }

  function handleRemovePending(id: string) {
    setPendingPersons((prev) => prev.filter((person) => person.id !== id))
  }

  async function handleReoptimize() {
    if (!scenarioResult) return
    const persons: NewPersonInput[] = pendingPersons.map((person) => ({
      firstName: person.firstName,
      lastName: person.lastName,
      location: [person.position[1], person.position[0]],
    }))
    const result = await submitNewPersons(scenarioResult.id, persons)
    if (result?.status === 'completed') {
      setPendingPersons([])
      setIsPicking(false)
    }
  }

  const displayedRoutes = scenarioResult?.routes ?? []
  const unassignedPersonIds = scenarioResult?.unassignedPersonIds ?? []
  const stopSummary = scenarioResult?.stopGenerationSummary ?? null
  const realStops = scenarioResult?.stops ?? null
  const warnings = scenarioResult?.warnings ?? []

  const deadlineNote =
    scenarioResult?.deadlineMet === false ? ' Uyarı: bazı araçlar varış saatini kaçırdı.' : ''

  const statusMessage: Record<typeof scenarioState, string> = {
    idle: 'Senaryoyu oluşturunca gerçek yürüme mesafesi özeti (foot-OSRM) burada görünecek.',
    submitting: 'Senaryo gönderiliyor…',
    waiting: liveStatus === 'running' ? 'Optimizasyon çalışıyor…' : 'Senaryo kuyrukta bekliyor…',
    completed: `Senaryo tamamlandı: ${scenarioResult?.routes.length ?? 0} rota, ${unassignedPersonIds.length} atanamayan personel.${deadlineNote}`,
    failed: `Senaryo başarısız: ${errorMessage}`,
  }

  const unassignedPersons = (scenarioResult?.unassignedPersons ?? []).map((entry) => ({
    id: entry.id,
    name: entry.id,
    reason: unassignedReasonLabels[entry.reason] ?? entry.reason,
  }))

  const visibleStopCount = (realStops ?? []).length
  const visiblePersonCount = stopSummary?.assignedPersonCount ?? null
  const statusTone = scenarioState === 'failed'
    ? 'error'
    : scenarioState === 'completed'
      ? 'success'
      : isBusy
        ? 'progress'
        : 'neutral'

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand-lockup">
          <span className="brand-mark" aria-hidden="true">
            <svg viewBox="0 0 40 40" role="presentation">
              <path d="M10 11h10c7 0 10 4 10 9s-3 9-10 9H10" />
              <circle cx="10" cy="11" r="3" />
              <circle cx="10" cy="29" r="3" />
              <circle cx="30" cy="20" r="3" />
            </svg>
          </span>
          <span>
            <strong>Servis Optimizasyon</strong>
            <small>Operasyon paneli</small>
          </span>
        </div>
        <div className="system-status">
          <span aria-hidden="true" />
          Planlama servisi hazır
        </div>
      </header>

      <section className="hero">
        <div className="hero-copy">
          <p className="eyebrow">Akıllı personel ulaşımı</p>
          <h1>Daha kısa yürüyüşler.<br />Daha verimli servis rotaları.</h1>
          <p className="hero-description">
            Personel konumlarını, araç kapasitelerini ve varış saatini birlikte değerlendirerek
            dakikalar içinde uygulanabilir servis planları oluşturun.
          </p>
          <div className="hero-features" aria-label="Optimizasyon özellikleri">
            <span><i aria-hidden="true">✓</i> 500 m yürüme sınırı</span>
            <span><i aria-hidden="true">✓</i> Kapasite kontrollü</span>
            <span><i aria-hidden="true">✓</i> Gerçek yol ağı</span>
          </div>
        </div>
        <div className="hero-route" aria-hidden="true">
          <div className="route-card route-card-primary">
            <span className="route-card-icon">↗</span>
            <span><small>Aktif rota</small><strong>5 araç planlandı</strong></span>
          </div>
          <svg viewBox="0 0 420 250" role="presentation">
            <path className="route-line route-line-shadow" d="M31 198C88 128 116 207 178 139S270 60 388 50" />
            <path className="route-line" d="M31 198C88 128 116 207 178 139S270 60 388 50" />
            <circle className="route-point start" cx="31" cy="198" r="9" />
            <circle className="route-point" cx="178" cy="139" r="7" />
            <circle className="route-point end" cx="388" cy="50" r="10" />
          </svg>
          <div className="route-card route-card-secondary">
            <span><small>Ortalama doluluk</small><strong>%84</strong></span>
            <span className="mini-bars"><i /><i /><i /><i /></span>
          </div>
        </div>
      </section>

      <section className="planner-card" aria-labelledby="planner-title">
        <div className="section-heading planner-heading">
          <div>
            <p className="section-kicker">Yeni planlama</p>
            <h2 id="planner-title">Senaryonuzu oluşturun</h2>
            <span>Excel dosyanızı yükleyerek gerçek personel ve işyeri adresleriyle senaryo oluşturun.</span>
          </div>
        </div>
        <ExcelImportForm
          onSubmit={(form) => void submitExcelImport(form)}
          disabled={isBusy}
          isBusy={isBusy}
        />
      </section>

      <section className="map-section" aria-labelledby="map-title">
        <div className="section-heading map-heading">
          <div>
            <p className="section-kicker">Canlı önizleme</p>
            <h2 id="map-title">Rota haritası</h2>
          </div>
          <div className="map-legend" aria-label="Harita açıklaması">
            <span><i className="legend-person" /> Yeni personel</span>
            <span><i className="legend-stop" /> Durak</span>
          </div>
        </div>
        <AddPersonPanel
          isPicking={isPicking}
          onTogglePicking={handleTogglePicking}
          draftLocation={draftLocation}
          onConfirmDraft={handleConfirmDraft}
          onCancelDraft={handleCancelDraft}
          pendingPersons={pendingPersons}
          onRemovePending={handleRemovePending}
          onReoptimize={() => void handleReoptimize()}
          disabled={isBusy || !scenarioResult}
          isBusy={isBusy}
        />
        <div className="map-layout">
          <ScenarioMap
            routes={displayedRoutes}
            pendingPersons={pendingPersons as PersonPoint[]}
            realStops={realStops}
            pickMode={isPicking && !draftLocation}
            onPickLocation={handleMapPick}
          />
          <aside className="scenario-summary" aria-label="Senaryo özeti">
            <div className="summary-header">
              <div>
                <p className="section-kicker">Anlık özet</p>
                <h3>{scenarioResult?.name ?? 'Excel senaryosu'}</h3>
              </div>
              <span className={`summary-state ${statusTone}`}>
                <i aria-hidden="true" />
                {scenarioState === 'completed' ? 'Tamamlandı' : isBusy ? 'İşleniyor' : scenarioState === 'failed' ? 'Hata' : 'Önizleme'}
              </span>
            </div>
            <div className="summary-metrics">
              <div><span>Personel</span><strong>{visiblePersonCount ?? '—'}</strong></div>
              <div><span>Araç</span><strong>{displayedRoutes.length || '—'}</strong></div>
              <div><span>Durak</span><strong>{visibleStopCount}</strong></div>
              <div><span>Rota</span><strong>{displayedRoutes.length}</strong></div>
            </div>
            <div className={`status-callout ${statusTone}`} aria-live="polite">
              <span className="status-callout-icon" aria-hidden="true" />
              <span>{statusMessage[scenarioState]}</span>
            </div>
            {warnings.length > 0 && <div className="status-warning">{warnings.join(' ')}</div>}
            {stopSummary && (
              <div className="walking-summary">
                <span>Yürüme performansı</span>
                <strong>
                  {stopSummary.averageWalkingDistanceMeters != null
                    ? `${Math.round(stopSummary.averageWalkingDistanceMeters)} m ortalama`
                    : 'Veri bekleniyor'}
                </strong>
                <div className="walking-bar"><i style={{ width: `${Math.min(100, ((stopSummary.averageWalkingDistanceMeters ?? 0) / 500) * 100)}%` }} /></div>
                <small>
                  {stopSummary.assignedPersonCount} atanan · {stopSummary.unassignedPersonCount} atanamayan
                </small>
              </div>
            )}
          </aside>
        </div>
      </section>

      <div className="results-grid">
        <RouteTable routes={displayedRoutes} isMock={false} />
        <UnassignedList persons={unassignedPersons} />
      </div>

      <footer>
        <span>Servis Optimizasyon</span>
        <span>OSRM ve VROOM destekli rota planlama</span>
      </footer>
    </main>
  )
}
