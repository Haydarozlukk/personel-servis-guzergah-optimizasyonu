import { useState } from 'react'
import type { PersonPoint } from '../lib/person'

export type PendingPerson = PersonPoint & { firstName: string; lastName: string }

type AddPersonPanelProps = {
  isPicking: boolean
  onTogglePicking: () => void
  draftLocation: [number, number] | null
  onConfirmDraft: (firstName: string, lastName: string) => void
  onCancelDraft: () => void
  pendingPersons: PendingPerson[]
  onRemovePending: (id: string) => void
  onReoptimize: () => void
  disabled: boolean
  isBusy: boolean
}

export function AddPersonPanel({
  isPicking,
  onTogglePicking,
  draftLocation,
  onConfirmDraft,
  onCancelDraft,
  pendingPersons,
  onRemovePending,
  onReoptimize,
  disabled,
  isBusy,
}: AddPersonPanelProps) {
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')

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
    <section className="add-person-panel" aria-label="Haritadan personel ekle">
      <div className="section-heading add-person-heading">
        <div>
          <p className="section-kicker">Sonradan ekleme</p>
          <h3>Personel ekle</h3>
        </div>
        <button
          type="button"
          className={`secondary${isPicking ? ' active' : ''}`}
          disabled={disabled}
          onClick={onTogglePicking}
        >
          {isPicking ? 'Haritada bir noktaya tıklayın' : 'Haritadan personel ekle'}
        </button>
      </div>

      {draftLocation && (
        <div className="draft-person-form">
          <label>
            <span>Ad</span>
            <input
              type="text"
              autoFocus
              value={firstName}
              onChange={(event) => setFirstName(event.target.value)}
            />
          </label>
          <label>
            <span>Soyad</span>
            <input type="text" value={lastName} onChange={(event) => setLastName(event.target.value)} />
          </label>
          <div className="draft-person-actions">
            <button
              type="button"
              className="primary-action"
              disabled={!firstName.trim() || !lastName.trim()}
              onClick={handleConfirm}
            >
              Ekle
            </button>
            <button type="button" className="secondary" onClick={handleCancel}>
              Vazgeç
            </button>
          </div>
        </div>
      )}

      {pendingPersons.length > 0 && (
        <>
          <ul className="manual-person-list" aria-label="Eklenmeyi bekleyen personel">
            {pendingPersons.map((person) => (
              <li key={person.id}>
                <span>{person.name}</span>
                <button
                  type="button"
                  aria-label={`${person.name} kaldır`}
                  disabled={isBusy}
                  onClick={() => onRemovePending(person.id)}
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
          <button className="primary-action" type="button" disabled={isBusy} onClick={onReoptimize}>
            {isBusy && <span className="spinner" aria-hidden="true" />}
            {isBusy ? 'Yeniden optimize ediliyor…' : 'Rotayı yeniden optimize et'}
            {!isBusy && <span className="button-arrow" aria-hidden="true">→</span>}
          </button>
        </>
      )}
    </section>
  )
}
