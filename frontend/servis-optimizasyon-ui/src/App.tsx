import { Circle, CircleMarker, MapContainer, Marker, Popup, TileLayer } from 'react-leaflet'
import { mockPersons, mockWorkplace } from './mock/scenario'

export function App() {
  return (
    <main>
      <header>
        <p className="eyebrow">Faz 0 · Mock veri</p>
        <h1>Personel Servis Güzergâh Optimizasyonu</h1>
        <p>Personel noktaları, 500 metre yürüme sınırı ve sabah işe gidiş senaryosu.</p>
      </header>
      <section className="map-shell" aria-label="Ankara personel haritası">
        <MapContainer center={[39.9334, 32.8597]} zoom={13} scrollWheelZoom>
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
          {mockPersons.map((person) => (
            <CircleMarker key={person.id} center={person.position} radius={7} pathOptions={{ color: '#216e39' }}>
              <Popup>{person.name}</Popup>
            </CircleMarker>
          ))}
          <Marker position={mockWorkplace}>
            <Popup>İşyeri hedefi</Popup>
          </Marker>
          <Circle center={mockWorkplace} radius={500} pathOptions={{ color: '#cc5d00', fillOpacity: 0.08 }} />
        </MapContainer>
      </section>
      <aside>
        <strong>{mockPersons.length} mock personel</strong>
        <span>Gerçek 500 m doğrulaması Faz 2’de foot-OSRM ile yapılacaktır.</span>
      </aside>
    </main>
  )
}
