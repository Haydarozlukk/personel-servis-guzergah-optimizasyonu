import { useState } from 'react'
import { findNearbyServices, type NearbyService } from '../lib/api'

export function NearbyServicesPanel({ scenarioId, onClose, onSelectVehicle }: {
  scenarioId: string
  onClose: () => void
  onSelectVehicle: (vehicleId: string) => void
}) {
  const [address, setAddress] = useState('')
  const [services, setServices] = useState<NearbyService[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function search() {
    if (!address.trim()) return
    setBusy(true); setError('')
    try { setServices((await findNearbyServices(scenarioId, address.trim())).services) }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Servisler aranamadı.') }
    finally { setBusy(false) }
  }

  return <div className="op-admin-layer"><section className="op-admin-panel op-scroll">
    <header><div><p className="op-kicker">Bir günlük adres sorgusu</p><h2>Yakındaki servisler</h2></div><button className="op-close" onClick={onClose}>×</button></header>
    <p className="op-auth-copy">Adres hiçbir yolcuya veya servise kaydedilmez. Bütün servisler eşik uygulanmadan yakınlığa göre listelenir.</p>
    <div className="op-nearby-search"><input value={address} placeholder="Adres girin" onChange={(event) => setAddress(event.target.value)} onKeyDown={(event) => event.key === 'Enter' && void search()} /><button className="op-btn op-btn-primary" disabled={busy || !address.trim()} onClick={() => void search()}>{busy ? 'Aranıyor…' : 'Servisleri getir'}</button></div>
    {services.map((service, index) => <article className="op-admin-user" key={service.vehicleId}>
      <div><strong>{index + 1}. {service.vehicleId}</strong><span>{Math.round(service.distanceMeters)} m · {service.nearestStopId ?? 'güzergâh'} · {service.load}/{service.effectiveCapacity} koltuk</span></div>
      <button className="op-btn op-btn-secondary" onClick={() => { onSelectVehicle(service.vehicleId); onClose() }}>Servisi göster</button>
    </article>)}
    {error && <p className="op-error-text">{error}</p>}
  </section></div>
}
