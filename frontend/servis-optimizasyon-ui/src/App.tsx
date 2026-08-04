import { useMemo, useState } from 'react'
import { createMockPersons, createMockRoutes, createMockStops, mockWorkplace } from './mock/scenario'
import { useScenarioSubmission } from './hooks/useScenarioSubmission'
import { ScenarioControls } from './components/ScenarioControls'
import { ExcelImportForm } from './components/ExcelImportForm'
import { ScenarioMap } from './components/ScenarioMap'
import { RouteTable } from './components/RouteTable'
import { UnassignedList } from './components/UnassignedList'

const unassignedReasonLabels: Record<string, string> = {
  no_candidate_within_limit: '500 m içinde durak yok',
  no_route: 'yürüme rotası yok',
  stop_capacity_full: 'durak kapasitesi doldu',
  not_routed: 'araç kapasitesi yetersiz',
}

type Mode = 'mock' | 'excel'

export function App() {
  const [mode, setMode] = useState<Mode>('mock')
  const [personCount, setPersonCount] = useState(50)
  const [vehicleCount, setVehicleCount] = useState(5)
  const [vehicleCapacity, setVehicleCapacity] = useState(16)
  const { scenarioState, scenarioResult, liveStatus, errorMessage, submitScenario, submitExcelImport } =
    useScenarioSubmission()

  const mockPersons = useMemo(() => createMockPersons(personCount), [personCount])
  const mockStops = useMemo(() => createMockStops(mockPersons), [mockPersons])
  const mockRoutes = useMemo(
    () => createMockRoutes(mockStops, vehicleCount, mockWorkplace),
    [mockStops, vehicleCount],
  )

  // The Excel-import flow has no client-side spiral data to preview before a
  // real result comes back — persons and their coordinates only ever exist
  // server-side, per docs/kararlar.md — so its "mock preview" is empty.
  const displayedMockPersons = mode === 'mock' ? mockPersons : []
  const displayedMockStops = mode === 'mock' ? mockStops : []
  const displayedMockRoutes = mode === 'mock' ? mockRoutes : []

  const displayedRoutes = scenarioResult?.routes ?? displayedMockRoutes
  const unassignedPersonIds = scenarioResult?.unassignedPersonIds ?? []
  const stopSummary = scenarioResult?.stopGenerationSummary ?? null
  const realStops = scenarioResult?.stops ?? null
  const warnings = scenarioResult?.warnings ?? []

  const isBusy = scenarioState === 'submitting' || scenarioState === 'waiting'
  const isPositiveInteger = (value: number) => Number.isInteger(value) && value >= 1
  const validationErrors = [
    !isPositiveInteger(personCount) && 'Personel sayısı en az 1 olmalı.',
    !isPositiveInteger(vehicleCount) && 'Araç sayısı en az 1 olmalı.',
    !isPositiveInteger(vehicleCapacity) && 'Araç kapasitesi en az 1 olmalı.',
  ].filter((error): error is string => Boolean(error))
  const isFormValid = validationErrors.length === 0
  const totalCapacity = vehicleCount * vehicleCapacity
  const capacityWarning =
    isFormValid && totalCapacity < personCount
      ? `Toplam araç kapasitesi (${totalCapacity}) personel sayısından (${personCount}) az; bazı personel atanamayabilir.`
      : null

  function handleMockSubmit() {
    void submitScenario({
      name: 'Kullanıcı tanımlı sabah senaryosu',
      direction: 'morning_inbound',
      workplace: [mockWorkplace[1], mockWorkplace[0]],
      arrivalDeadline: '08:30:00',
      persons: mockPersons.map((person) => ({
        id: person.id,
        location: [person.position[1], person.position[0]],
      })),
      vehicles: Array.from({ length: vehicleCount }, (_, index) => ({
        id: `vehicle-${String(index + 1).padStart(3, '0')}`,
        capacity: vehicleCapacity,
        start: [mockWorkplace[1], mockWorkplace[0]],
      })),
    })
  }

  const deadlineNote =
    scenarioResult?.deadlineMet === false ? ' Uyarı: bazı araçlar varış saatini kaçırdı.' : ''

  const statusMessage: Record<typeof scenarioState, string> = {
    idle: 'Senaryoyu oluşturunca gerçek yürüme mesafesi özeti (foot-OSRM) burada görünecek.',
    submitting: 'Senaryo gönderiliyor…',
    waiting: liveStatus === 'running' ? 'Optimizasyon çalışıyor…' : 'Senaryo kuyrukta bekliyor…',
    completed: `Senaryo tamamlandı: ${scenarioResult?.routes.length ?? 0} rota, ${unassignedPersonIds.length} atanamayan personel.${deadlineNote}`,
    failed: `Senaryo başarısız: ${errorMessage}`,
  }

  const unassignedPersons = scenarioResult
    ? (scenarioResult.unassignedPersons ?? []).map((entry) => ({
        id: entry.id,
        name: mockPersons.find((person) => person.id === entry.id)?.name ?? entry.id,
        reason: unassignedReasonLabels[entry.reason] ?? entry.reason,
      }))
    : mockPersons
        .filter((person) => unassignedPersonIds.includes(person.id))
        .map((person) => ({ id: person.id, name: person.name, reason: null as string | null }))

  const visibleStopCount = (realStops ?? displayedMockStops).length
  const visiblePersonCount = mode === 'mock' ? personCount : stopSummary?.assignedPersonCount ?? null
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
            <span>Örnek veriyle hızlıca deneyin veya kendi Excel dosyanızı kullanın.</span>
          </div>
          <div className="mode-toggle" role="tablist" aria-label="Senaryo veri kaynağı">
            <button
              type="button"
              role="tab"
              aria-selected={mode === 'mock'}
              className={mode === 'mock' ? 'active' : ''}
              disabled={isBusy}
              onClick={() => setMode('mock')}
            >
              Hızlı senaryo
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={mode === 'excel'}
              className={mode === 'excel' ? 'active' : ''}
              disabled={isBusy}
              onClick={() => setMode('excel')}
            >
              Excel'den aktar
            </button>
          </div>
        </div>
        {mode === 'mock' ? (
          <ScenarioControls
            personCount={personCount}
            vehicleCount={vehicleCount}
            vehicleCapacity={vehicleCapacity}
            onPersonCountChange={setPersonCount}
            onVehicleCountChange={setVehicleCount}
            onVehicleCapacityChange={setVehicleCapacity}
            onSubmit={handleMockSubmit}
            disabled={isBusy || !isFormValid}
            isBusy={isBusy}
            validationErrors={validationErrors}
            capacityWarning={capacityWarning}
          />
        ) : (
          <ExcelImportForm
            onSubmit={(form) => void submitExcelImport(form)}
            disabled={isBusy}
            isBusy={isBusy}
          />
        )}
      </section>

      <section className="map-section" aria-labelledby="map-title">
        <div className="section-heading map-heading">
          <div>
            <p className="section-kicker">Canlı önizleme</p>
            <h2 id="map-title">Rota haritası</h2>
          </div>
          <div className="map-legend" aria-label="Harita açıklaması">
            <span><i className="legend-person" /> Personel</span>
            <span><i className="legend-stop" /> Durak</span>
            <span><i className="legend-workplace" /> İşyeri</span>
          </div>
        </div>
        <div className="map-layout">
          <ScenarioMap
            routes={displayedRoutes}
            persons={displayedMockPersons}
            unassignedPersonIds={unassignedPersonIds}
            realStops={realStops}
            mockStops={displayedMockStops}
            workplace={mockWorkplace}
          />
          <aside className="scenario-summary" aria-label="Senaryo özeti">
            <div className="summary-header">
              <div>
                <p className="section-kicker">Anlık özet</p>
                <h3>{scenarioResult?.name ?? (mode === 'mock' ? 'Örnek sabah planı' : 'Excel senaryosu')}</h3>
              </div>
              <span className={`summary-state ${statusTone}`}>
                <i aria-hidden="true" />
                {scenarioState === 'completed' ? 'Tamamlandı' : isBusy ? 'İşleniyor' : scenarioState === 'failed' ? 'Hata' : 'Önizleme'}
              </span>
            </div>
            <div className="summary-metrics">
              <div><span>Personel</span><strong>{visiblePersonCount ?? '—'}</strong></div>
              <div><span>Araç</span><strong>{mode === 'mock' ? vehicleCount : displayedRoutes.length || '—'}</strong></div>
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
        <RouteTable routes={displayedRoutes} isMock={mode === 'mock' && !scenarioResult} />
        <UnassignedList persons={unassignedPersons} />
      </div>

      <footer>
        <span>Servis Optimizasyon</span>
        <span>OSRM ve VROOM destekli rota planlama</span>
      </footer>
    </main>
  )
}
