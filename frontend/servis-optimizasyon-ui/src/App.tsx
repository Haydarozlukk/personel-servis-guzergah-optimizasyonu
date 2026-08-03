import { useMemo, useState } from 'react'
import { Circle, CircleMarker, MapContainer, Marker, Polyline, Popup, TileLayer } from 'react-leaflet'
import { createMockPersons, createMockRoutes, createMockStops, mockWorkplace } from './mock/scenario'
import { decodePolyline } from './lib/polyline'

const routeColors = ['#1d4ed8', '#7c3aed', '#059669', '#db2777', '#ea580c', '#0891b2']

export function App() {
  const [personCount, setPersonCount] = useState(50)
  const [vehicleCount, setVehicleCount] = useState(5)
  const [vehicleCapacity, setVehicleCapacity] = useState(16)
  const [submitMessage, setSubmitMessage] = useState('')
  const mockPersons = useMemo(() => createMockPersons(personCount), [personCount])
  const mockStops = useMemo(() => createMockStops(mockPersons), [mockPersons])
  const mockRoutes = useMemo(
    () => createMockRoutes(mockStops, vehicleCount, mockWorkplace),
    [mockStops, vehicleCount],
  )

  async function createScenario() {
    setSubmitMessage('Senaryo gönderiliyor…')
    const response = await fetch(`${import.meta.env.VITE_API_BASE_URL}/api/v1/scenarios`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Kullanıcı tanımlı sabah senaryosu',
        direction: 'morning_inbound',
        workplace: [mockWorkplace[1], mockWorkplace[0]],
        arrivalDeadline: '08:30:00',
        persons: mockPersons.map((person) => ({ id: person.id, location: [person.position[1], person.position[0]] })),
        vehicles: Array.from({ length: vehicleCount }, (_, index) => ({
          id: `vehicle-${String(index + 1).padStart(3, '0')}`,
          capacity: vehicleCapacity,
          start: [mockWorkplace[1], mockWorkplace[0]],
        })),
      }),
    })
    setSubmitMessage(response.ok ? 'Senaryo kabul edildi; optimizasyon kuyruğa alınacak.' : 'Senaryo gönderilemedi.')
  }

  return (
    <main>
      <header>
        <p className="eyebrow">Faz 0 · Mock veri</p>
        <h1>Personel Servis Güzergâh Optimizasyonu</h1>
        <p>Personel ve araç sayısını seç, ardından sabah işe gidiş senaryosunu oluştur.</p>
      </header>
      <section className="controls" aria-label="Senaryo girdileri">
        <label>Personel sayısı<input type="number" min="1" value={personCount} onChange={(event) => setPersonCount(Number(event.target.value))} /></label>
        <label>Araç sayısı<input type="number" min="1" value={vehicleCount} onChange={(event) => setVehicleCount(Number(event.target.value))} /></label>
        <label>Araç kapasitesi<input type="number" min="1" value={vehicleCapacity} onChange={(event) => setVehicleCapacity(Number(event.target.value))} /></label>
        <button type="button" onClick={() => void createScenario()}>Senaryoyu oluştur</button>
      </section>
      <section className="map-shell" aria-label="Ankara personel haritası">
        <MapContainer center={[39.9334, 32.8597]} zoom={13} scrollWheelZoom>
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
          {mockRoutes.map((route, index) => (
            <Polyline
              key={route.vehicleId}
              positions={decodePolyline(route.geometry)}
              pathOptions={{ color: routeColors[index % routeColors.length], weight: 4, opacity: 0.85 }}
            />
          ))}
          {mockPersons.map((person) => (
            <CircleMarker key={person.id} center={person.position} radius={7} pathOptions={{ color: '#216e39' }}>
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
              <Popup>{stop.id} · {stop.assignedPersonIds.length} personel</Popup>
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
        <span>{mockStops.length} durak adayı · {mockRoutes.length} rota çizildi</span>
        <span>{submitMessage || 'Gerçek 500 m doğrulaması Faz 2’de foot-OSRM ile yapılacaktır.'}</span>
      </aside>
    </main>
  )
}
