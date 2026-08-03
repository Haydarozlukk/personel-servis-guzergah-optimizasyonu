import { useMemo, useState } from 'react'
import { Circle, CircleMarker, MapContainer, Marker, Polyline, Popup, TileLayer } from 'react-leaflet'
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
  const [errorMessage, setErrorMessage] = useState('')
  const mockPersons = useMemo(() => createMockPersons(personCount), [personCount])
  const mockStops = useMemo(() => createMockStops(mockPersons), [mockPersons])
  const mockRoutes = useMemo(
    () => createMockRoutes(mockStops, vehicleCount, mockWorkplace),
    [mockStops, vehicleCount],
  )

  const displayedRoutes = scenarioResult?.routes ?? mockRoutes
  const unassignedPersonIds = scenarioResult?.unassignedPersonIds ?? []

  async function submitScenario() {
    setScenarioState('submitting')
    setErrorMessage('')
    setScenarioResult(null)
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
      const result = await waitForScenarioResult(accepted.id)
      setScenarioResult(result)
      setScenarioState(result.status === 'completed' ? 'completed' : 'failed')
      if (result.status === 'failed') setErrorMessage(result.error ?? 'Senaryo başarısız oldu.')
    } catch (error) {
      setScenarioState('failed')
      setErrorMessage(error instanceof Error ? error.message : 'Senaryo gönderilemedi.')
    }
  }

  const statusMessage: Record<ScenarioState, string> = {
    idle: 'Senaryoyu oluşturunca gerçek yürüme mesafesi özeti (foot-OSRM) burada görünecek.',
    submitting: 'Senaryo gönderiliyor…',
    waiting: 'Optimizasyon sonucu bekleniyor…',
    completed: `Senaryo tamamlandı: ${scenarioResult?.routes.length ?? 0} rota, ${unassignedPersonIds.length} atanamayan personel.`,
    failed: `Senaryo başarısız: ${errorMessage}`,
  }

  const stopSummary = scenarioResult?.stopGenerationSummary ?? null

  return (
    <main>
      <header>
        <p className="eyebrow">Faz 2 · Gerçek yürüme mesafesi özeti</p>
        <h1>Personel Servis Güzergâh Optimizasyonu</h1>
        <p>Personel ve araç sayısını seç, ardından sabah işe gidiş senaryosunu oluştur.</p>
      </header>
      <section className="controls" aria-label="Senaryo girdileri">
        <label>Personel sayısı<input type="number" min="1" value={personCount} onChange={(event) => setPersonCount(Number(event.target.value))} /></label>
        <label>Araç sayısı<input type="number" min="1" value={vehicleCount} onChange={(event) => setVehicleCount(Number(event.target.value))} /></label>
        <label>Araç kapasitesi<input type="number" min="1" value={vehicleCapacity} onChange={(event) => setVehicleCapacity(Number(event.target.value))} /></label>
        <button
          type="button"
          disabled={scenarioState === 'submitting' || scenarioState === 'waiting'}
          onClick={() => void submitScenario()}
        >
          Senaryoyu oluştur
        </button>
      </section>
      <section className="map-shell" aria-label="Ankara personel haritası">
        <MapContainer center={[39.9334, 32.8597]} zoom={13} scrollWheelZoom>
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
          {displayedRoutes.map((route, index) => (
            <Polyline
              key={route.vehicleId}
              positions={decodePolyline(route.geometry)}
              pathOptions={{ color: routeColors[index % routeColors.length], weight: 4, opacity: 0.85 }}
            />
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
          {mockStops.map((stop) => (
            <CircleMarker
              key={stop.id}
              center={stop.location}
              radius={10}
              pathOptions={{ color: '#cc5d00', fillColor: '#ffb703', fillOpacity: 0.9, weight: 2 }}
            >
              <Popup>
                {stop.id} · {stop.assignedPersonIds.length} personel (önizleme — gerçek durak konumları
                /stops/generate yalnızca backend içinden çağrılabildiği için haritada gösterilemiyor;
                aşağıdaki özet gerçek foot-OSRM sonucudur)
              </Popup>
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
        <span>{mockStops.length} durak adayı (önizleme) · {displayedRoutes.length} rota çizildi{scenarioResult ? ' (API sonucu)' : ' (mock)'}</span>
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
    </main>
  )
}
