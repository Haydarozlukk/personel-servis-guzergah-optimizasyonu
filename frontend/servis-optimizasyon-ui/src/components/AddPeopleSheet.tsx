import { useState } from 'react'
import type { ExcelImportForm as ExcelImportFormData } from '../lib/api'
import { ExcelImportSheet, type ImportMode } from './ExcelImportSheet'
import { PersonAddSheet, type PendingPerson } from './PersonAddSheet'

type AddPeopleSheetProps = {
  hasActivePlan: boolean
  onSubmitExcel: (form: ExcelImportFormData & { mode: ImportMode }) => void
  excelDisabled: boolean
  excelBusy: boolean
  excelErrorMessage: string
  isPicking: boolean
  onTogglePicking: () => void
  draftLocation: [number, number] | null
  onLocationFound: (position: [number, number]) => void
  onConfirmDraft: (firstName: string, lastName: string) => void
  onCancelDraft: () => void
  pendingPersons: PendingPerson[]
  onRemovePending: (id: string) => void
  onReoptimize: () => void
  manualDisabled: boolean
  manualBusy: boolean
}

export function AddPeopleSheet({
  hasActivePlan,
  onSubmitExcel,
  excelDisabled,
  excelBusy,
  excelErrorMessage,
  isPicking,
  onTogglePicking,
  draftLocation,
  onLocationFound,
  onConfirmDraft,
  onCancelDraft,
  pendingPersons,
  onRemovePending,
  onReoptimize,
  manualDisabled,
  manualBusy,
}: AddPeopleSheetProps) {
  const [tab, setTab] = useState<'manual' | 'excel'>('manual')

  return (
    <div>
      <div className="op-tab-switch" role="tablist">
        <button type="button" role="tab" aria-selected={tab === 'manual'} className={`op-tab${tab === 'manual' ? ' active' : ''}`} onClick={() => setTab('manual')}>
          Manuel Ekle
        </button>
        <button type="button" role="tab" aria-selected={tab === 'excel'} className={`op-tab${tab === 'excel' ? ' active' : ''}`} onClick={() => setTab('excel')}>
          Excel'den İçeri Aktar
        </button>
      </div>

      {tab === 'manual' ? (
        <PersonAddSheet
          isPicking={isPicking}
          onTogglePicking={onTogglePicking}
          draftLocation={draftLocation}
          onLocationFound={onLocationFound}
          onConfirmDraft={onConfirmDraft}
          onCancelDraft={onCancelDraft}
          pendingPersons={pendingPersons}
          onRemovePending={onRemovePending}
          onReoptimize={onReoptimize}
          disabled={manualDisabled}
          isBusy={manualBusy}
        />
      ) : (
        <ExcelImportSheet
          onSubmit={onSubmitExcel}
          disabled={excelDisabled}
          isBusy={excelBusy}
          errorMessage={excelErrorMessage}
          hasActivePlan={hasActivePlan}
        />
      )}
    </div>
  )
}
