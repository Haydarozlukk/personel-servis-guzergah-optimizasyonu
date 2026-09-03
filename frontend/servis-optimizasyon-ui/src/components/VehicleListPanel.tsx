import { useState } from 'react'

export type VehicleRow = {
  id: string
  label?: string | null
  capacity: number
  load: number
  summary: string
  routed: boolean
  color: string
  nearbyDistanceMeters?: number
  isNearest?: boolean
}

type VehicleListPanelProps = {
  vehicles: VehicleRow[]
  selectedVehicleId: string | null
  onSelect: (id: string) => void
  unassignedPersonCount: number
  assignedPersonCount: number
  onOpenUnassigned: () => void
  onAddVehicle: () => void
  onUnassignAll: () => void
  onBulkAddVehicles: (text: string) => string[]
  onMove: (id: string, direction: -1 | 1) => void
}

export function VehicleListPanel({ vehicles, selectedVehicleId, onSelect, unassignedPersonCount, assignedPersonCount, onOpenUnassigned, onAddVehicle, onUnassignAll, onBulkAddVehicles, onMove }: VehicleListPanelProps) {
  const [bulkOpen, setBulkOpen] = useState(false)
  const [bulkText, setBulkText] = useState('')

  function handleBulkSubmit() {
    if (!bulkText.trim()) return
    const errors = onBulkAddVehicles(bulkText)
    if (errors.length > 0) {
      alert(`Bazı satırlar eklenemedi:\n${errors.join('\n')}`)
    }
    setBulkText('')
    setBulkOpen(false)
  }

  return (
    <div className="op-vehicle-panel op-scroll" aria-label="Araç filosu">
      <div className="op-vehicle-panel-header">
        <div>
          <p className="op-kicker">Filo</p>
          <h3>Araçlar</h3>
        </div>
        <button className="op-badge op-badge-button" onClick={onAddVehicle}>+ Araç</button>
      </div>
      <button className="op-btn op-btn-secondary op-btn-small" onClick={() => setBulkOpen((prev) => !prev)}>
        {bulkOpen ? 'Toplu ekleme kapat' : 'Toplu araç ekle (Excel\'den yapıştır)'}
      </button>
      {bulkOpen && (
        <div className="op-bulk-vehicle-form">
          <p className="op-advice-note">
            ⓘ Excel'de "isim" ve "kapasite" sütunlarını seçip kopyalayın, aşağıya yapıştırın. Her satır bir araç
            olur; "18+1" gibi değerlerden ilk sayı (18) kapasite olarak alınır.
          </p>
          <textarea
            rows={6}
            placeholder={'AYVALI-PAMUKLAR-ŞENTEPE\t18+1\nBAŞLICA\t27+1'}
            value={bulkText}
            onChange={(event) => setBulkText(event.target.value)}
          />
          <button className="op-btn op-btn-primary op-btn-small" disabled={!bulkText.trim()} onClick={handleBulkSubmit}>
            Yapıştırılanları ekle
          </button>
        </div>
      )}
      {unassignedPersonCount > 0 && (
        <button className="op-vehicle-panel-warning op-warning-button" onClick={onOpenUnassigned}>{unassignedPersonCount} yolcu servis atanmamış · aç</button>
      )}
      {assignedPersonCount > 0 && (
        <button
          className="op-btn op-btn-secondary op-btn-small"
          title="Tüm servislere atanmış yolcuları atanmamış listesine taşır"
          onClick={() => {
            if (confirm(`${assignedPersonCount} yolcu tüm servislerden çıkarılıp atanmamış listesine taşınsın mı? Bu işlem geri alınamaz.`)) {
              onUnassignAll()
            }
          }}
        >
          Tümünü atanmamışa al ({assignedPersonCount})
        </button>
      )}
      <ul className="op-vehicle-list">
        {vehicles.map((vehicle, index) => {
          const selected = vehicle.id === selectedVehicleId
          return (
            <li key={vehicle.id}>
              <button
                type="button"
                className={`op-vehicle-row${selected ? ' selected' : ''}`}
                onClick={() => onSelect(vehicle.id)}
              >
                <div className="op-vehicle-row-top">
                  <span className="op-vehicle-row-name">
                    <i style={{ background: vehicle.routed ? vehicle.color : 'var(--border-strong)' }} />
                    {vehicle.label || vehicle.id}
                  </span>
                  {vehicle.nearbyDistanceMeters !== undefined ? (
                    <span className="op-vehicle-row-distance">
                      {Math.round(vehicle.nearbyDistanceMeters)} m
                      {vehicle.isNearest && <span className="op-vehicle-near-chip">Yakın</span>}
                    </span>
                  ) : (
                    <span className="op-vehicle-row-capacity">{vehicle.load}/{vehicle.capacity} kişi</span>
                  )}
                </div>
                <span className={`op-vehicle-row-summary${vehicle.routed ? '' : ' unrouted'}`}>{vehicle.summary}</span>
              </button>
              <span className="op-vehicle-order-buttons" aria-label={`${vehicle.label || vehicle.id} sıralama`}>
                <button type="button" aria-label="Yukarı taşı" disabled={index === 0} onClick={() => onMove(vehicle.id, -1)}>↑</button>
                <button type="button" aria-label="Aşağı taşı" disabled={index === vehicles.length - 1} onClick={() => onMove(vehicle.id, 1)}>↓</button>
              </span>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
