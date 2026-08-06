import { useMemo, useRef, useState } from 'react'
import type { PersonPoint } from './lib/person'
import { downloadPlanExport, saveActivePlan, savePlanVersion, type CurrentUser, type ScenarioResult, type ScenarioVehicle } from './lib/api'
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
import { AdminPanel } from './components/AuthShell'
import { VersionPanel } from './components/VersionPanel'
import { UnassignedPanel } from './components/UnassignedPanel'
import { NearbyServicesPanel } from './components/NearbyServicesPanel'
import {
  addManualStop, addUnassignedPerson, addVehicle, assignPerson, assignPersonToStop, deleteUnassignedPerson,
  moveStop, removeVehicle, unassignPerson, updateVehicle,
} from './lib/manualPlan'

type ActiveOverlay = 'none' | 'excel' | 'person'

export function App({ currentUser, onLogout }: { currentUser: CurrentUser; onLogout: () => Promise<void> }) {
  const [activeOverlay, setActiveOverlay] = useState<ActiveOverlay>('none')
  const [selectedVehicleId, setSelectedVehicleId] = useState<string | null>(null)
  const [pendingPersons, setPendingPersons] = useState<PendingPerson[]>([])
  const [isPicking, setIsPicking] = useState(false)
  const [draftLocation, setDraftLocation] = useState<[number, number] | null>(null)
  const [showAdmin, setShowAdmin] = useState(false)
  const [showVersions, setShowVersions] = useState(false)
  const [showUnassigned, setShowUnassigned] = useState(false)
  const [showNearbyServices, setShowNearbyServices] = useState(false)
  const [stopPickVehicleId, setStopPickVehicleId] = useState<string | null>(null)
  const [manualError, setManualError] = useState('')
  const persistenceQueue = useRef<Promise<unknown>>(Promise.resolve())
  const { scenarioState, scenarioResult, liveStatus, errorMessage, submitExcelImport, submitFullReoptimization, replaceScenarioResult } =
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
    if (stopPickVehicleId && scenarioResult) {
      const next = addManualStop(scenarioResult, stopPickVehicleId, [position[1], position[0]])
      persistManualPlan(next)
      setSelectedVehicleId(stopPickVehicleId)
      setStopPickVehicleId(null)
      return
    }
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

  async function handleAddPersons() {
    if (!scenarioResult) return
    let next = scenarioResult
    for (const pending of pendingPersons) {
      let id = pending.id
      let suffix = 2
      while (next.persons.some((person) => person.id === id)) id = `${pending.id}-${suffix++}`
      next = addUnassignedPerson(next, {
        id, name: pending.name, location: [pending.position[1], pending.position[0]],
      })
    }
    persistManualPlan(next)
    setPendingPersons([])
    closeSheet()
  }

  function persistManualPlan(next: ScenarioResult) {
    replaceScenarioResult(next)
    setManualError('')
    persistenceQueue.current = persistenceQueue.current
      .then(() => saveActivePlan(next.id, next))
      .catch((reason) => setManualError(reason instanceof Error ? reason.message : 'Manuel plan kaydedilemedi.'))
    return next
  }

  async function handleFullReoptimize(plan = scenarioResult) {
    if (!plan) return
    const approved = confirm('Tam optimizasyon tüm araçları, durak sıralarını ve yolcu atamalarını değiştirebilir. İşlemden önce otomatik snapshot alınacak. Devam edilsin mi?')
    if (!approved) return
    await persistenceQueue.current
    const stamp = new Date().toLocaleString('tr-TR')
    setSelectedVehicleId(null)
    await submitFullReoptimization(plan.id, `Tam optimizasyon öncesi ${stamp}`, plan)
  }

  function handleFleetChanged(next: ScenarioResult) {
    persistManualPlan(next)
    if (confirm('Filo değişikliği kaydedildi. Yeni araç yapısına göre tam optimizasyon yapılsın mı? Mevcut manuel ayarların değişebileceği uyarısı bir sonraki adımda gösterilecektir.')) {
      void handleFullReoptimize(next)
    }
  }

  function handleAddVehicle() {
    if (!scenarioResult) return
    let index = scenarioResult.vehicles.length + 1
    let id = `Servis-${String(index).padStart(3, '0')}`
    while (scenarioResult.vehicles.some((vehicle) => vehicle.id === id)) id = `Servis-${String(++index).padStart(3, '0')}`
    const vehicle: ScenarioVehicle = { id, capacity: 18, reservedSeats: 0, effectiveCapacity: 18, start: null, plate: null }
    handleFleetChanged(addVehicle(scenarioResult, vehicle))
  }

  async function handleSaveVersion() {
    if (!scenarioResult) return
    const name = prompt('Versiyon adı')?.trim()
    if (!name) return
    const description = prompt('Açıklama (opsiyonel)') ?? ''
    try { await savePlanVersion(scenarioResult.id, name, description, scenarioResult) }
    catch (reason) { alert(reason instanceof Error ? reason.message : 'Versiyon kaydedilemedi.') }
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
        ? route.geometry
          ? `${(route.distanceMeters / 1000).toFixed(1)} km · ${Math.round(route.durationSeconds / 60)} dk`
          : `Manuel sıra · ${route.load} yolcu`
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
        pickMode={(activeOverlay === 'person' && isPicking && !draftLocation) || !!stopPickVehicleId}
        onPickLocation={handleMapPick}
      />

      {activeOverlay === 'none' && (
        <>
          <TopActionButtons
            onOpenExcel={() => setActiveOverlay('excel')}
            onOpenPerson={() => setActiveOverlay('person')}
            onSaveVersion={() => void handleSaveVersion()}
            onOpenVersions={() => scenarioResult && setShowVersions(true)}
            onExport={() => scenarioResult && void downloadPlanExport(scenarioResult.id)}
            onFullReoptimize={() => void handleFullReoptimize()}
            onNearbyServices={() => scenarioResult && setShowNearbyServices(true)}
            onAdmin={currentUser.role === 'admin' ? () => setShowAdmin(true) : undefined}
            onLogout={() => void onLogout()}
          />
          <VehicleListPanel
            vehicles={vehicleRows}
            selectedVehicleId={selectedVehicleId}
            onSelect={handleSelectVehicle}
            unassignedPersonCount={unassignedPersonIds.length}
            onOpenUnassigned={() => setShowUnassigned(true)}
            onAddVehicle={handleAddVehicle}
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
            onReoptimize={() => void handleAddPersons()}
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
          persons={scenarioResult?.persons ?? []}
          unassignedPersonIds={unassignedPersonIds}
          vehicles={allVehicles}
          allRoutes={displayedRoutes}
          workplace={scenarioResult?.workplace ?? null}
          color={vehicleColors.get(selectedVehicleId) ?? '#c8d5ca'}
          onClose={() => setSelectedVehicleId(null)}
          onUpdateVehicle={(patch) => scenarioResult && handleFleetChanged(updateVehicle(scenarioResult, selectedVehicleId, patch))}
          onMovePerson={(personId, vehicleId) => scenarioResult && persistManualPlan(assignPerson(scenarioResult, personId, vehicleId))}
          onUnassignPerson={(personId) => scenarioResult && persistManualPlan(unassignPerson(scenarioResult, personId))}
          onPickStop={() => { setStopPickVehicleId(selectedVehicleId); setSelectedVehicleId(null) }}
          onMoveStop={(stopId, direction) => scenarioResult && persistManualPlan(moveStop(scenarioResult, selectedVehicleId, stopId, direction))}
          onAssignToStop={(personId, stopId) => scenarioResult && persistManualPlan(assignPersonToStop(scenarioResult, personId, stopId))}
          onDeleteVehicle={() => {
            if (!scenarioResult) return
            setSelectedVehicleId(null)
            handleFleetChanged(removeVehicle(scenarioResult, selectedVehicleId))
          }}
        />
      )}

      {showAdmin && <AdminPanel onClose={() => setShowAdmin(false)} />}
      {showVersions && scenarioResult && <VersionPanel
        scenarioId={scenarioResult.id}
        onClose={() => setShowVersions(false)}
        onActivated={(plan) => replaceScenarioResult(plan)}
      />}
      {showUnassigned && scenarioResult && <UnassignedPanel
        plan={scenarioResult}
        vehicles={allVehicles}
        onClose={() => setShowUnassigned(false)}
        onAssign={(personId, vehicleId) => persistManualPlan(assignPerson(scenarioResult, personId, vehicleId))}
        onDelete={(personId) => persistManualPlan(deleteUnassignedPerson(scenarioResult, personId))}
      />}
      {showNearbyServices && scenarioResult && <NearbyServicesPanel
        scenarioId={scenarioResult.id}
        onClose={() => setShowNearbyServices(false)}
        onSelectVehicle={setSelectedVehicleId}
      />}

      {stopPickVehicleId && <div className="op-map-pick-banner">Haritada yeni durağın yerini seçin · <button onClick={() => setStopPickVehicleId(null)}>Vazgeç</button></div>}

      <StatusStrip
        tone={statusTone}
        message={statusMessage[scenarioState]}
        warnings={manualError ? [...warnings, manualError] : warnings}
        unassignedPersonCount={unassignedPersonIds.length}
        stopSummary={stopSummary}
      />
    </main>
  )
}
