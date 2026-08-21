import { useMemo, useRef, useState } from 'react'
import type { PersonPoint } from './lib/person'
import { downloadPlanExport, saveActivePlan, type NearbyServicesResponse, type ScenarioResult, type ScenarioVehicle } from './lib/api'
import { useScenarioSubmission } from './hooks/useScenarioSubmission'
import { ScenarioMap } from './components/ScenarioMap'
import { ActionMenu } from './components/ActionMenu'
import { MapSearchBar } from './components/MapSearchBar'
import { VehicleListPanel, type VehicleRow } from './components/VehicleListPanel'
import { OverlaySheet } from './components/OverlaySheet'
import { AddPeopleSheet } from './components/AddPeopleSheet'
import { type PendingPerson } from './components/PersonAddSheet'
import { VehicleDrawer } from './components/VehicleDrawer'
import { StatusStrip, type StatusTone } from './components/StatusStrip'
import { routeColors } from './lib/colors'
import { routeStopIds } from './lib/routeLike'
import { buildPersonHomes } from './lib/personHomes'
import { VersionPanel } from './components/VersionPanel'
import { UnassignedPanel } from './components/UnassignedPanel'
import {
  addManualStop, addVehicle, assignPerson, assignPersonToStop, deleteUnassignedPerson, distributePersonsToPlan,
  moveStop, moveStopLocation, moveVehicleStartLocation, removeStop, removeVehicle, unassignPerson, updateVehicle,
} from './lib/manualPlan'

type ActiveOverlay = 'none' | 'add'

export function App({ onLogout }: { onLogout: () => Promise<void> }) {
  const [activeOverlay, setActiveOverlay] = useState<ActiveOverlay>('none')
  const [selectedVehicleId, setSelectedVehicleId] = useState<string | null>(null)
  const [pendingPersons, setPendingPersons] = useState<PendingPerson[]>([])
  const [isPicking, setIsPicking] = useState(false)
  const [draftLocation, setDraftLocation] = useState<[number, number] | null>(null)
  const [showVersions, setShowVersions] = useState(false)
  const [showUnassigned, setShowUnassigned] = useState(false)
  const [nearbySearch, setNearbySearch] = useState<NearbyServicesResponse | null>(null)
  const [stopPickVehicleId, setStopPickVehicleId] = useState<string | null>(null)
  const [focusedLocation, setFocusedLocation] = useState<number[] | null>(null)
  const [manualError, setManualError] = useState('')
  const persistenceQueue = useRef<Promise<unknown>>(Promise.resolve())
  const { scenarioState, scenarioResult, liveStatus, errorMessage, submitExcelImport, submitExcelAppend, submitFullReoptimization, replaceScenarioResult } =
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
    if (!scenarioResult || pendingPersons.length === 0) return
    const personsToDistribute = pendingPersons.map((pending) => ({
      id: pending.id,
      name: pending.name,
      address: `${pending.firstName} ${pending.lastName}`,
      location: [pending.position[1], pending.position[0]],
    }))
    const next = distributePersonsToPlan(scenarioResult, personsToDistribute)
    persistManualPlan(next)
    setPendingPersons([])
    closeSheet()
  }

  function persistManualPlan(next: ScenarioResult) {
    replaceScenarioResult(next)
    setManualError('')
    persistenceQueue.current = persistenceQueue.current
      .then(() => saveActivePlan(next.id, next))
      .then((saved) => {
        if (saved) replaceScenarioResult(saved)
      })
      .catch((reason) => setManualError(reason instanceof Error ? reason.message : 'Manuel plan kaydedilemedi.'))
    return next
  }

  async function handleFullReoptimize(plan = scenarioResult) {
    if (!plan) return
    const approved = confirm('Tam optimizasyon tüm araçları, durak sıralarını ve yolcu atamalarını yeniden hesaplayacaktır. Devam edilsin mi?')
    if (!approved) return
    await persistenceQueue.current
    setSelectedVehicleId(null)
    await submitFullReoptimization(plan.id, null, plan)
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

  const nearbyByVehicle = useMemo(() => {
    const map = new Map<string, number>()
    nearbySearch?.services.forEach((service) => map.set(service.vehicleId, service.distanceMeters))
    return map
  }, [nearbySearch])

  const nearestVehicleId = useMemo(() => {
    if (!nearbySearch?.services.length) return null
    return nearbySearch.services.reduce((closest, service) =>
      service.distanceMeters < closest.distanceMeters ? service : closest,
    ).vehicleId
  }, [nearbySearch])

  const vehicleRows: VehicleRow[] = allVehicles
    .map((vehicle) => {
      const route = displayedRoutes.find((r) => r.vehicleId === vehicle.id)
      return {
        id: vehicle.id,
        label: vehicle.label ?? null,
        capacity: vehicle.capacity,
        load: route?.load ?? 0,
        routed: !!route,
        color: vehicleColors.get(vehicle.id) ?? routeColors[0],
        summary: route
          ? route.geometry
            ? `${(route.distanceMeters / 1000).toFixed(1)} km · ${Math.round(route.durationSeconds / 60)} dk`
            : `Manuel sıra · ${route.load} yolcu`
          : 'Rota atanmadı',
        nearbyDistanceMeters: nearbyByVehicle.get(vehicle.id),
        isNearest: vehicle.id === nearestVehicleId,
      }
    })
    .sort((a, b) => (a.nearbyDistanceMeters ?? Infinity) - (b.nearbyDistanceMeters ?? Infinity))

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

  const filteredStops = useMemo(() => {
    if (!realStops) return null
    if (!selectedVehicleId || !selectedRoute) return realStops
    const stopIds = routeStopIds(selectedRoute)
    return realStops.filter((stop) => stopIds.has(stop.id))
  }, [realStops, selectedVehicleId, selectedRoute])

  // Eşleme filtresiz rotalar/duraklar üzerinden kurulur; seçim süzgeci yalnızca
  // buildPersonHomes içinde bir kez uygulanır.
  const personHomes = useMemo(() => buildPersonHomes({
    persons: scenarioResult?.persons ?? [],
    stops: realStops ?? [],
    routes: displayedRoutes,
    vehicleColors,
    selectedVehicleId,
  }), [scenarioResult, realStops, displayedRoutes, vehicleColors, selectedVehicleId])

  const personNameById = useMemo(
    () => new Map((scenarioResult?.persons ?? []).map((person) => [person.id, person.name || person.id])),
    [scenarioResult],
  )

  const filteredVehicles = useMemo(() => {
    if (!selectedVehicleId) return allVehicles
    return allVehicles.filter((v) => v.id === selectedVehicleId)
  }, [allVehicles, selectedVehicleId])

  function handleMoveStopLocation(stopId: string, location: [number, number]) {
    if (!scenarioResult) return
    const next = moveStopLocation(scenarioResult, stopId, location)
    persistManualPlan(next)
  }

  function handleMoveVehicleStart(vehicleId: string, location: [number, number]) {
    if (!scenarioResult) return
    const next = moveVehicleStartLocation(scenarioResult, vehicleId, location)
    persistManualPlan(next)
  }

  return (
    <main className="op-shell">
      <ScenarioMap
        routes={selectedVehicleId ? displayedRoutes.filter((r) => r.vehicleId === selectedVehicleId) : displayedRoutes}
        pendingPersons={pendingPersons as PersonPoint[]}
        personHomes={personHomes}
        realStops={filteredStops}
        workplace={scenarioResult?.workplace ?? null}
        vehicles={filteredVehicles}
        vehicleColors={vehicleColors}
        selectedVehicleId={selectedVehicleId}
        personNameById={personNameById}
        pickMode={(activeOverlay === 'add' && isPicking && !draftLocation) || !!stopPickVehicleId}
        focusedLocation={focusedLocation}
        searchMarker={nearbySearch ? { location: nearbySearch.location, address: nearbySearch.address } : null}
        onPickLocation={handleMapPick}
        onMoveStopLocation={handleMoveStopLocation}
        onMoveVehicleStart={handleMoveVehicleStart}
        onSelectVehicle={handleSelectVehicle}
      />

      {activeOverlay === 'none' && (
        <>
          <ActionMenu
            onOpenAdd={() => setActiveOverlay('add')}
            onOpenVersions={() => scenarioResult && setShowVersions(true)}
            onExport={() => scenarioResult && void downloadPlanExport(scenarioResult.id)}
            onFullReoptimize={() => void handleFullReoptimize()}
            onLogout={() => void onLogout()}
          />
          {scenarioResult && (
            <MapSearchBar
              scenarioId={scenarioResult.id}
              result={nearbySearch}
              onResult={(result) => {
                setNearbySearch(result)
                if (result) setFocusedLocation(result.location)
              }}
            />
          )}
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

      {activeOverlay === 'add' && (
        <OverlaySheet kicker="Sonradan ekleme" title="Kişi Ekle" onClose={closeSheet}>
          <AddPeopleSheet
            hasActivePlan={Boolean(scenarioResult)}
            onSubmitExcel={(form) => {
              setActiveOverlay('none')
              if (form.mode === 'distribute' && scenarioResult) {
                void submitExcelAppend(scenarioResult.id, scenarioResult, form)
              } else {
                void submitExcelImport(form)
              }
            }}
            excelDisabled={isBusy}
            excelBusy={isBusy}
            excelErrorMessage={scenarioState === 'failed' ? errorMessage : ''}
            isPicking={isPicking}
            onTogglePicking={handleTogglePicking}
            draftLocation={draftLocation}
            onLocationFound={handleLocationFound}
            onConfirmDraft={handleConfirmDraft}
            onCancelDraft={handleCancelDraft}
            pendingPersons={pendingPersons}
            onRemovePending={handleRemovePending}
            onReoptimize={() => void handleAddPersons()}
            manualDisabled={isBusy || !scenarioResult}
            manualBusy={isBusy}
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
          onPickStop={() => { setStopPickVehicleId(selectedVehicleId) }}
          onMoveStop={(stopId, direction) => scenarioResult && persistManualPlan(moveStop(scenarioResult, selectedVehicleId, stopId, direction))}
          onAssignToStop={(personId, stopId) => scenarioResult && persistManualPlan(assignPersonToStop(scenarioResult, personId, stopId))}
          onDeleteStop={(stopId) => scenarioResult && persistManualPlan(removeStop(scenarioResult, selectedVehicleId, stopId))}
          onAddStopByAddress={(location) => {
            if (!scenarioResult) return
            const next = addManualStop(scenarioResult, selectedVehicleId, [location[1], location[0]])
            persistManualPlan(next)
            setFocusedLocation(next.stops[next.stops.length - 1]?.location ?? null)
          }}
          onSelectStop={(location) => setFocusedLocation(location)}
          onDeleteVehicle={() => {
            if (!scenarioResult) return
            setSelectedVehicleId(null)
            handleFleetChanged(removeVehicle(scenarioResult, selectedVehicleId))
          }}
        />
      )}

      {showVersions && scenarioResult && <VersionPanel
        scenarioId={scenarioResult.id}
        plan={scenarioResult}
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
