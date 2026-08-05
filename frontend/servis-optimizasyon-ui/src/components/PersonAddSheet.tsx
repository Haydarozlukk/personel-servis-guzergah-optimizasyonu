import { useState } from 'react'
import type { PersonPoint } from '../lib/person'
import { geocodeAddress } from '../lib/geocode'

export type PendingPerson = PersonPoint & { firstName: string; lastName: string }

type PersonAddSheetProps = {
  isPicking: boolean
  onTogglePicking: () => void
  draftLocation: [number, number] | null
  onLocationFound: (position: [number, number]) => void
  onConfirmDraft: (firstName: string, lastName: string) => void
  onCancelDraft: () => void
  pendingPersons: PendingPerson[]
  onRemovePending: (id: string) => void
  onReoptimize: () => void
  disabled: boolean
  isBusy: boolean
}

export function PersonAddSheet({
  isPicking,
  onTogglePicking,
  draftLocation,
  onLocationFound,
  onConfirmDraft,
  onCancelDraft,
  pendingPersons,
  onRemovePending,
  onReoptimize,
  disabled,
  isBusy,
}: PersonAddSheetProps) {
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [addressQuery, setAddressQuery] = useState('')
  const [geocoding, setGeocoding] = useState(false)
  const [geocodeError, setGeocodeError] = useState('')

  async function handleGeocode() {
    const query = addressQuery.trim()
    if (!query || geocoding) return
    setGeocoding(true)
    setGeocodeError('')
    try {
      const { lat, lon } = await geocodeAddress(query)
      onLocationFound([lat, lon])
    } catch (error) {
      setGeocodeError(error instanceof Error ? error.message : 'Adres aranırken hata oluştu.')
    } finally {
      setGeocoding(false)
    }
  }

  function handleConfirm() {
    if (!firstName.trim() || !lastName.trim()) return
    onConfirmDraft(firstName.trim(), lastName.trim())
    setFirstName('')
    setLastName('')
  }

  function handleCancel() {
    setFirstName('')
    setLastName('')
    onCancelDraft()
  }

  return (
    <div>
      <div className="op-person-search">
        <label className="op-field-wide">
          <span>Adres ile ekle</span>
          <input
            type="text"
            placeholder="Örn. Kızılırmak Mah., Çankaya/Ankara"
            value={addressQuery}
            disabled={disabled}
            onChange={(event) => setAddressQuery(event.target.value)}
          />
        </label>
        <button type="button" className="op-btn op-btn-primary" disabled={disabled || geocoding} onClick={() => void handleGeocode()}>
          {geocoding ? 'Aranıyor…' : 'Bul'}
        </button>
        <button
          type="button"
          className={`op-btn op-btn-secondary${isPicking ? ' active' : ''}`}
          disabled={disabled}
          onClick={onTogglePicking}
        >
          {isPicking ? 'Haritada bir noktaya tıklayın' : 'Haritadan personel ekle'}
        </button>
      </div>

      {geocodeError && <p className="op-error-text">{geocodeError}</p>}

      {draftLocation && (
        <div className="op-draft-form">
          <label>
            <span>Ad</span>
            <input type="text" autoFocus value={firstName} onChange={(event) => setFirstName(event.target.value)} />
          </label>
          <label>
            <span>Soyad</span>
            <input type="text" value={lastName} onChange={(event) => setLastName(event.target.value)} />
          </label>
          <div className="op-sheet-actions">
            <button
              type="button"
              className="op-btn op-btn-primary"
              disabled={!firstName.trim() || !lastName.trim()}
              onClick={handleConfirm}
            >
              Ekle
            </button>
            <button type="button" className="op-btn op-btn-secondary" onClick={handleCancel}>
              Vazgeç
            </button>
          </div>
        </div>
      )}

      {pendingPersons.length > 0 && (
        <>
          <ul className="op-pending-list" aria-label="Eklenmeyi bekleyen personel">
            {pendingPersons.map((person) => (
              <li key={person.id}>
                <span>{person.name}</span>
                <button type="button" aria-label={`${person.name} kaldır`} disabled={isBusy} onClick={() => onRemovePending(person.id)}>
                  ×
                </button>
              </li>
            ))}
          </ul>
          <button type="button" className="op-btn op-btn-primary op-reoptimize" disabled={isBusy} onClick={onReoptimize}>
            {isBusy && <span className="op-spinner" aria-hidden="true" />}
            {isBusy ? 'Yeniden optimize ediliyor…' : 'Rotayı yeniden optimize et →'}
          </button>
        </>
      )}
    </div>
  )
}
