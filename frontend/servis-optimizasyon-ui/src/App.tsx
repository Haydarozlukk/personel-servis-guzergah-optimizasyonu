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

  return (
    <main>
      <header>
        <p className="eyebrow">Faz 5 · Gerçek backend ile uçtan uca doğrulandı</p>
        <h1>Personel Servis Güzergâh Optimizasyonu</h1>
        <p>Mock veri ile deneyin ya da gerçek personel/araç listenizi Excel'den yükleyin.</p>
      </header>
      <div className="mode-toggle" role="tablist" aria-label="Senaryo veri kaynağı">
        <button
          type="button"
          role="tab"
          aria-selected={mode === 'mock'}
          className={mode === 'mock' ? 'active' : ''}
          disabled={isBusy}
          onClick={() => setMode('mock')}
        >
          Mock senaryo
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mode === 'excel'}
          className={mode === 'excel' ? 'active' : ''}
          disabled={isBusy}
          onClick={() => setMode('excel')}
        >
          Excel'den içe aktar
        </button>
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
      <ScenarioMap
        routes={displayedRoutes}
        persons={displayedMockPersons}
        unassignedPersonIds={unassignedPersonIds}
        realStops={realStops}
        mockStops={displayedMockStops}
        workplace={mockWorkplace}
      />
      <aside>
        <strong>
          {mode === 'mock'
            ? `${personCount} personel · ${vehicleCount} araç · araç başına ${vehicleCapacity} koltuk`
            : "Excel'den içe aktarılan senaryo"}
        </strong>
        <span>
          {(realStops ?? displayedMockStops).length} durak{realStops ? '' : mode === 'mock' ? ' adayı (önizleme)' : ''} ·{' '}
          {displayedRoutes.length} rota çizildi{scenarioResult ? ' (API sonucu)' : mode === 'mock' ? ' (mock)' : ''}
        </span>
        {warnings.length > 0 && <span className="status-warning">{warnings.join(' ')}</span>}
        {stopSummary && (
          <span>
            Gerçek durak özeti: {stopSummary.stopCount} durak · {stopSummary.assignedPersonCount} atanan ·{' '}
            {stopSummary.unassignedPersonCount} atanamayan personel
            {stopSummary.averageWalkingDistanceMeters != null &&
              ` · ort. yürüme ${Math.round(stopSummary.averageWalkingDistanceMeters)} m`}
            {stopSummary.maximumWalkingDistanceMeters != null &&
              ` (maks. ${Math.round(stopSummary.maximumWalkingDistanceMeters)} m)`}
            {stopSummary.averageWalkingDurationSeconds != null &&
              ` · ort. yürüme süresi ${Math.round(stopSummary.averageWalkingDurationSeconds)} sn`}
          </span>
        )}
        <span className={scenarioState === 'failed' ? 'status-error' : undefined}>{statusMessage[scenarioState]}</span>
      </aside>
      <RouteTable routes={displayedRoutes} isMock={mode === 'mock' && !scenarioResult} />
      <UnassignedList persons={unassignedPersons} />
    </main>
  )
}
