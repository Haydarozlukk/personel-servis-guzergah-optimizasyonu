import { useMemo, useState } from 'react'
import type { PersonPoint } from './lib/person'
import type { NewPersonInput } from './lib/api'
import { useScenarioSubmission } from './hooks/useScenarioSubmission'
import { ScenarioMap } from './components/ScenarioMap'
import { TopActionButtons } from './components/TopActionButtons'
import { VehicleListPanel, type VehicleRow } from './components/VehicleListPanel'
import { OverlaySheet } from './components/OverlaySheet'
import { ExcelImportSheet } from './components/ExcelImportSheet'
import { PersonAddSheet, type PendingPerson } from './components/PersonAddSheet'
import { VehicleDrawer } from './components/VehicleDrawer'
import { StatusStrip, type StatusTone } from './components/StatusStrip'
import { routeColors } from './lib/colors'

type ActiveOverlay = 'none' | 'excel' | 'person'

export function App() {
  const [activeOverlay, setActiveOverlay] = useState<ActiveOverlay>('none')
  const [selectedVehicleId, setSelectedVehicleId] = useState<string | null>(null)
  const [pendingPersons, setPendingPersons] = useState<PendingPerson[]>([])
  const [isPicking, setIsPicking] = useState(false)
  const [draftLocation, setDraftLocation] = useState<[number, number] | null>(null)
  const { scenarioState, scenarioResult, liveStatus, errorMessage, submitExcelImport, submitNewPersons } =
    useScenarioSubmission()

  const isBusy = scenarioState === 'submitting' || scenarioState === 'waiting'

  function closeSheet() {
    setActiveOverlay('none')
    setIsPicking(false)
    setDraftLocation(null)
  }

  function handleTogglePicking() {
    setDraftLocation(null)
    setIsPicking((prev) => !prev)
  }

  function handleMapPick(position: [number, number]) {
    if (draftLocation) return
    setDraftLocation(position)
  }

  function handleLocationFound(position: [number, number]) {
    setIsPicking(false)
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

  function handleSelectVehicle(id: string) {
    setSelectedVehicleId((prev) => (prev === id ? null : id))
  }

  async function handleReoptimize() {
    if (!scenarioResult) return
    setActiveOverlay('none')
    setIsPicking(false)
    const persons: NewPersonInput[] = pendingPersons.map((person) => ({
      firstName: person.firstName,
      lastName: person.lastName,
      location: [person.position[1], person.position[0]],
    }))
    const result = await submitNewPersons(scenarioResult.id, persons)
    if (result?.status === 'completed') {
      setPendingPersons([])
    }
  }

  const displayedRoutes = useMemo(() => scenarioResult?.routes ?? [], [scenarioResult])
  const allVehicles = scenarioResult?.vehicles ?? []
  const realStops = scenarioResult?.stops ?? null
  const unassignedPersonIds = scenarioResult?.unassignedPersonIds ?? []
  const stopSummary = scenarioResult?.stopGenerationSummary ?? null
  const warnings = scenarioResult?.warnings ?? []

  const vehicleColors = useMemo(() => {
    const map = new Map<string, string>()
    displayedRoutes.forEach((route, index) => map.set(route.vehicleId, routeColors[index % routeColors.length]))
    return map
  }, [displayedRoutes])

  const vehicleRows: VehicleRow[] = allVehicles.map((vehicle) => {
    const route = displayedRoutes.find((r) => r.vehicleId === vehicle.id)
    return {
      id: vehicle.id,
      capacity: vehicle.capacity,
      routed: !!route,
      color: vehicleColors.get(vehicle.id) ?? routeColors[0],
      summary: route
        ? `${(route.distanceMeters / 1000).toFixed(1)} km · ${Math.round(route.durationSeconds / 60)} dk`
        : 'Rota atanmadı',
    }
  })

  const selectedVehicle = allVehicles.find((v) => v.id === selectedVehicleId)
  const selectedRoute = displayedRoutes.find((r) => r.vehicleId === selectedVehicleId)

  const deadlineNote =
    scenarioResult?.deadlineMet === false ? ' Uyarı: bazı araçlar varış saatini kaçırdı.' : ''

  const statusMessage: Record<typeof scenarioState, string> = {
    idle: 'Senaryoyu oluşturunca gerçek yürüme mesafesi özeti (foot-OSRM) burada görünecek.',
    submitting: 'Senaryo gönderiliyor…',
    waiting: liveStatus === 'running' ? 'Optimizasyon çalışıyor…' : 'Senaryo kuyrukta bekliyor…',
    completed: `Senaryo tamamlandı: ${scenarioResult?.routes.length ?? 0} rota, ${unassignedPersonIds.length} atanamayan personel.${deadlineNote}`,
    failed: `Senaryo başarısız: ${errorMessage}`,
  }

  const statusTone: StatusTone = scenarioState === 'failed'
    ? 'error'
    : scenarioState === 'completed'
      ? 'success'
      : isBusy
        ? 'progress'
        : 'neutral'

  return (
    <main className="op-shell">
      <ScenarioMap
        routes={displayedRoutes}
        pendingPersons={pendingPersons as PersonPoint[]}
        realStops={realStops}
        workplace={scenarioResult?.workplace ?? null}
        vehicles={allVehicles}
        pickMode={activeOverlay === 'person' && isPicking && !draftLocation}
        onPickLocation={handleMapPick}
      />

      {activeOverlay === 'none' && (
        <>
          <TopActionButtons onOpenExcel={() => setActiveOverlay('excel')} onOpenPerson={() => setActiveOverlay('person')} />
          <VehicleListPanel
            vehicles={vehicleRows}
            selectedVehicleId={selectedVehicleId}
            onSelect={handleSelectVehicle}
            unassignedPersonCount={unassignedPersonIds.length}
          />
        </>
      )}

      {activeOverlay === 'excel' && (
        <OverlaySheet kicker="Yeni planlama" title="Excel Aktar" onClose={closeSheet}>
          <ExcelImportSheet
            onSubmit={(form) => {
              setActiveOverlay('none')
              void submitExcelImport(form)
            }}
            disabled={isBusy}
            isBusy={isBusy}
            errorMessage={scenarioState === 'failed' ? errorMessage : ''}
          />
        </OverlaySheet>
      )}

      {activeOverlay === 'person' && (
        <OverlaySheet kicker="Sonradan ekleme" title="Kişi Ekle" onClose={closeSheet}>
          <PersonAddSheet
            isPicking={isPicking}
            onTogglePicking={handleTogglePicking}
            draftLocation={draftLocation}
            onLocationFound={handleLocationFound}
            onConfirmDraft={handleConfirmDraft}
            onCancelDraft={handleCancelDraft}
            pendingPersons={pendingPersons}
            onRemovePending={handleRemovePending}
            onReoptimize={() => void handleReoptimize()}
            disabled={isBusy || !scenarioResult}
            isBusy={isBusy}
          />
        </OverlaySheet>
      )}

      {selectedVehicleId && (
        <VehicleDrawer
          vehicleId={selectedVehicleId}
          vehicle={selectedVehicle}
          route={selectedRoute}
          stops={realStops ?? []}
          workplace={scenarioResult?.workplace ?? null}
          color={vehicleColors.get(selectedVehicleId) ?? '#c8d5ca'}
          onClose={() => setSelectedVehicleId(null)}
        />
      )}

      <StatusStrip
        tone={statusTone}
        message={statusMessage[scenarioState]}
        warnings={warnings}
        unassignedPersonCount={unassignedPersonIds.length}
        stopSummary={stopSummary}
      />
    </main>
  )
}
