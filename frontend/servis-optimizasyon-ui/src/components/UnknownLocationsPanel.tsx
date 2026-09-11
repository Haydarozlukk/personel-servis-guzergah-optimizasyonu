import { useEffect, useState } from 'react'
import { getAddressReviews, type AddressReviewCandidate } from '../lib/api'

export function UnknownLocationsPanel({
  scenarioId, onClose, onFocus,
}: {
  scenarioId: string
  onClose: () => void
  onFocus: (personId: string) => void
}) {
  const [candidates, setCandidates] = useState<AddressReviewCandidate[]>([])
  const [failed, setFailed] = useState(false)
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    setLoaded(false)
    setFailed(false)
    getAddressReviews(scenarioId)
      .then((items) => { setCandidates(items); setLoaded(true) })
      .catch(() => { setFailed(true); setLoaded(true) })
  }, [scenarioId])

  return <div className="op-admin-layer"><section className="op-admin-panel op-scroll">
    <header><div><p className="op-kicker">Adres kontrolü</p><h2>Konumu belli olmayanlar</h2></div><button className="op-close" onClick={onClose}>×</button></header>
    <p className="op-all-passengers-note">Bu kişilerde yalnızca mahalle, ilçe veya bina numarası olmayan bir sonuç bulundu. Kişiye tıklayıp haritadaki ev simgesini doğru yere sürükleyin.</p>
    {failed && <p className="op-advice-note">Kontrol listesi yüklenemedi.</p>}
    {!failed && !loaded && <p className="op-drawer-empty">Kontrol listesi yükleniyor…</p>}
    {candidates.map((candidate) => <button className="op-location-review" key={candidate.personId} onClick={() => onFocus(candidate.personId)}>
      <strong>{candidate.name}</strong><span>{candidate.personId}</span>
      <small>Bulunan: {candidate.foundAddress}</small>
      <small>Kaynak adres: {candidate.sourceAddress}</small>
    </button>)}
    {loaded && !failed && candidates.length === 0 && <p className="op-drawer-empty">Bu senaryoda kontrol gerektiren kayıt yok.</p>}
  </section></div>
}
