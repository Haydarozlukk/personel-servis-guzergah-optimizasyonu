import { useMemo, useState } from 'react'
import { Circle, CircleMarker, MapContainer, Marker, Polyline, Popup, TileLayer, Tooltip } from 'react-leaflet'
import { createMockPersons, createMockRoutes, createMockStops, mockWorkplace } from './mock/scenario'
import { decodePolyline } from './lib/polyline'
import { createScenario as postScenario, waitForScenarioResult, type ScenarioResult } from './lib/api'

const routeColors = ['#1d4ed8', '#7c3aed', '#059669', '#db2777', '#ea580c', '#0891b2']

type ScenarioState = 'idle' | 'submitting' | 'waiting' | 'completed' | 'failed'

export function App() {
  const [personCount, setPersonCount] = useState(50)
  const [vehicleCount, setVehicleCount] = useState(5)
  const [vehicleCapacity, setVehicleCapacity] = useState(16)
  const [scenarioState, setScenarioState] = useState<ScenarioState>('idle')
  const [scenarioResult, setScenarioResult] = useState<ScenarioResult | null>(null)
  const [liveStatus, setLiveStatus] = useState<'queued' | 'running' | null>(null)
  const [errorMessage, setErrorMessage] = useState('')
  const mockPersons = useMemo(() => createMockPersons(personCount), [personCount])
  const mockStops = useMemo(() => createMockStops(mockPersons), [mockPersons])
  const mockRoutes = useMemo(
    () => createMockRoutes(mockStops, vehicleCount, mockWorkplace),
    [mockStops, vehicleCount],
  )

  const displayedRoutes = scenarioResult?.routes ?? mockRoutes
  const unassignedPersonIds = scenarioResult?.unassignedPersonIds ?? []

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

  async function submitScenario() {
    setScenarioState('submitting')
    setErrorMessage('')
    setScenarioResult(null)
    setLiveStatus(null)
    try {
      const accepted = await postScenario({
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
      setScenarioState('waiting')
      const result = await waitForScenarioResult(accepted.id, (update) => {
        setLiveStatus(update.status === 'queued' || update.status === 'running' ? update.status : null)
      })
      setScenarioResult(result)
      setScenarioState(result.status === 'completed' ? 'completed' : 'failed')
      if (result.status === 'failed') setErrorMessage(result.error ?? 'Senaryo başarısız oldu.')
    } catch (error) {
      setScenarioState('failed')
      setErrorMessage(error instanceof Error ? error.message : 'Senaryo gönderilemedi.')
    }
  }

  const deadlineNote =
    scenarioResult?.deadlineMet === false ? ' Uyarı: bazı araçlar varış saatini kaçırdı.' : ''

  const statusMessage: Record<ScenarioState, string> = {
    idle: 'Senaryoyu oluşturunca gerçek yürüme mesafesi özeti (foot-OSRM) burada görünecek.',
    submitting: 'Senaryo gönderiliyor…',
    waiting: liveStatus === 'running' ? 'Optimizasyon çalışıyor…' : 'Senaryo kuyrukta bekliyor…',
    completed: `Senaryo tamamlandı: ${scenarioResult?.routes.length ?? 0} rota, ${unassignedPersonIds.length} atanamayan personel.${deadlineNote}`,
    failed: `Senaryo başarısız: ${errorMessage}`,
  }

  const stopSummary = scenarioResult?.stopGenerationSummary ?? null
  const realStops = scenarioResult?.stops ?? null

  const unassignedReasonLabels: Record<string, string> = {
    no_candidate_within_limit: '500 m içinde durak yok',
    no_route: 'yürüme rotası yok',
    stop_capacity_full: 'durak kapasitesi doldu',
    not_routed: 'araç kapasitesi yetersiz',
  }
  const unassignedPersons = scenarioResult
    ? scenarioResult.unassignedPersons.map((entry) => ({
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
        <p>Personel ve araç sayısını seç, ardından sabah işe gidiş senaryosunu oluştur.</p>
      </header>
      <section className="controls" aria-label="Senaryo girdileri">
        <label>Personel sayısı
          <input
            type="number"
            min="1"
            value={personCount}
            disabled={isBusy}
            onChange={(event) => setPersonCount(Number(event.target.value))}
          />
        </label>
        <label>Araç sayısı
          <input
            type="number"
            min="1"
            value={vehicleCount}
            disabled={isBusy}
            onChange={(event) => setVehicleCount(Number(event.target.value))}
          />
        </label>
        <label>Araç kapasitesi
          <input
            type="number"
            min="1"
            value={vehicleCapacity}
            disabled={isBusy}
            onChange={(event) => setVehicleCapacity(Number(event.target.value))}
          />
        </label>
        <button type="button" disabled={isBusy || !isFormValid} onClick={() => void submitScenario()}>
          {isBusy && <span className="spinner" aria-hidden="true" />}
          Senaryoyu oluştur
        </button>
      </section>
      {validationErrors.length > 0 && (
        <p className="status-error">{validationErrors.join(' ')}</p>
      )}
      {capacityWarning && <p className="status-warning">{capacityWarning}</p>}
      <section className="map-shell" aria-label="Ankara personel haritası">
        <MapContainer center={[39.9334, 32.8597]} zoom={13} scrollWheelZoom preferCanvas>
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
          {displayedRoutes.map((route, index) => (
            <Polyline
              key={route.vehicleId}
              positions={decodePolyline(route.geometry)}
              pathOptions={{ color: routeColors[index % routeColors.length], weight: 4, opacity: 0.85 }}
            >
              <Tooltip sticky>
                {route.vehicleId} · {(route.distanceMeters / 1000).toFixed(1)} km ·{' '}
                {Math.round(route.durationSeconds / 60)} dk · yük {route.load}
              </Tooltip>
            </Polyline>
          ))}
          {mockPersons.map((person) => (
            <CircleMarker
              key={person.id}
              center={person.position}
              radius={7}
              pathOptions={{
                color: unassignedPersonIds.includes(person.id) ? '#dc2626' : '#216e39',
              }}
            >
              <Popup>{person.name}</Popup>
            </CircleMarker>
          ))}
          {realStops
            ? realStops.map((stop) => (
                <CircleMarker
                  key={stop.id}
                  center={[stop.location[1], stop.location[0]]}
                  radius={10}
                  pathOptions={{ color: '#cc5d00', fillColor: '#ffb703', fillOpacity: 0.9, weight: 2 }}
                >
                  <Popup>
                    {stop.id} · {stop.assignedPersonIds.length} personel · ort. yürüme{' '}
                    {Math.round(stop.averageWalkingDistanceMeters)} m · kalite{' '}
                    {Math.round(stop.qualityScore * 100)}%
                  </Popup>
                </CircleMarker>
              ))
            : mockStops.map((stop) => (
                <CircleMarker
                  key={stop.id}
                  center={stop.location}
                  radius={10}
                  pathOptions={{ color: '#cc5d00', fillColor: '#ffb703', fillOpacity: 0.9, weight: 2 }}
                >
                  <Popup>{stop.id} · {stop.assignedPersonIds.length} personel (önizleme)</Popup>
                </CircleMarker>
              ))}
          <Marker position={mockWorkplace}>
            <Popup>İşyeri hedefi</Popup>
          </Marker>
          <Circle center={mockWorkplace} radius={500} pathOptions={{ color: '#cc5d00', fillOpacity: 0.08 }} />
        </MapContainer>
      </section>
      <aside>
        <strong>{personCount} personel · {vehicleCount} araç · araç başına {vehicleCapacity} koltuk</strong>
        <span>
          {(realStops ?? mockStops).length} durak{realStops ? '' : ' adayı (önizleme)'} ·{' '}
          {displayedRoutes.length} rota çizildi{scenarioResult ? ' (API sonucu)' : ' (mock)'}
        </span>
        {scenarioResult && scenarioResult.warnings.length > 0 && (
          <span className="status-warning">{scenarioResult.warnings.join(' ')}</span>
        )}
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
      {displayedRoutes.length > 0 && (
        <section className="route-table" aria-label="Rota detayları">
          <h2>Rota detayları{scenarioResult ? '' : ' (mock önizleme)'}</h2>
          <table>
            <thead>
              <tr>
                <th></th>
                <th>Araç</th>
                <th>Mesafe</th>
                <th>Süre</th>
                <th>Yük</th>
              </tr>
            </thead>
            <tbody>
              {displayedRoutes.map((route, index) => (
                <tr key={route.vehicleId}>
                  <td><span className="route-swatch" style={{ background: routeColors[index % routeColors.length] }} /></td>
                  <td>{route.vehicleId}</td>
                  <td>{(route.distanceMeters / 1000).toFixed(1)} km</td>
                  <td>{Math.round(route.durationSeconds / 60)} dk</td>
                  <td>{route.load}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
      {unassignedPersons.length > 0 && (
        <section className="unassigned-list" aria-label="Atanamayan personel">
          <h2>Atanamayan personel ({unassignedPersons.length})</h2>
          <ul>
            {unassignedPersons.map((person) => (
              <li key={person.id}>{person.name}{person.reason ? ` — ${person.reason}` : ''}</li>
            ))}
          </ul>
        </section>
      )}
    </main>
  )
}
