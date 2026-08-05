import { useState } from 'react'
import { downloadImportTemplate, type ExcelImportForm as ExcelImportFormData } from '../lib/api'

type ExcelImportSheetProps = {
  onSubmit: (form: ExcelImportFormData) => void
  disabled: boolean
  isBusy: boolean
  errorMessage: string
}

export function ExcelImportSheet({ onSubmit, disabled, isBusy, errorMessage }: ExcelImportSheetProps) {
  const [file, setFile] = useState<File | null>(null)
  const [name, setName] = useState('Excel senaryosu')
  const [arrivalDeadline, setArrivalDeadline] = useState('08:30:00')
  const [workplaceAddress, setWorkplaceAddress] = useState('')
  const [vehicleCount, setVehicleCount] = useState('')
  const [vehicleCapacity, setVehicleCapacity] = useState('')
  const [templateError, setTemplateError] = useState('')

  const canSubmit = !disabled && file !== null && workplaceAddress.trim() !== ''

  function handleSubmit() {
    if (!file || !workplaceAddress.trim()) return
    onSubmit({
      file,
      name,
      arrivalDeadline,
      workplaceAddress: workplaceAddress.trim(),
      vehicleCount: vehicleCount === '' ? undefined : Number(vehicleCount),
      vehicleCapacity: vehicleCapacity === '' ? undefined : Number(vehicleCapacity),
    })
  }

  async function handleTemplateDownload() {
    setTemplateError('')
    try {
      await downloadImportTemplate()
    } catch (error) {
      setTemplateError(error instanceof Error ? error.message : 'Şablon indirilemedi.')
    }
  }

  return (
    <div className="op-sheet-fields">
      <label>
        <span>Senaryo adı</span>
        <input type="text" value={name} disabled={isBusy} onChange={(event) => setName(event.target.value)} />
      </label>
      <label>
        <span>Varış saati</span>
        <input
          type="time"
          step="1"
          value={arrivalDeadline}
          disabled={isBusy}
          onChange={(event) => setArrivalDeadline(event.target.value)}
        />
      </label>
      <label className="op-field-wide">
        <span>İşyeri adresi</span>
        <input
          type="text"
          placeholder="Örn. Kızılırmak Mah. 1443. Cad. No:5, Çankaya/Ankara"
          value={workplaceAddress}
          disabled={isBusy}
          onChange={(event) => setWorkplaceAddress(event.target.value)}
        />
      </label>
      <label>
        <span>Araç sayısı <small>opsiyonel</small></span>
        <input
          type="number"
          min="1"
          value={vehicleCount}
          disabled={isBusy}
          onChange={(event) => setVehicleCount(event.target.value)}
        />
      </label>
      <label>
        <span>Araç kapasitesi <small>opsiyonel</small></span>
        <input
          type="number"
          min="1"
          value={vehicleCapacity}
          disabled={isBusy}
          onChange={(event) => setVehicleCapacity(event.target.value)}
        />
      </label>
      <label className="op-field-wide">
        <span>Excel dosyası <small>.xlsx</small></span>
        <input
          type="file"
          accept=".xlsx"
          disabled={isBusy}
          onChange={(event) => setFile(event.target.files?.[0] ?? null)}
        />
      </label>
      <div className="op-sheet-actions">
        <button type="button" className="op-btn op-btn-primary" disabled={!canSubmit} onClick={handleSubmit}>
          {isBusy && <span className="op-spinner" aria-hidden="true" />}
          {isBusy ? 'Planlanıyor…' : 'Yükle ve optimize et →'}
        </button>
        <button type="button" className="op-btn op-btn-secondary" disabled={isBusy} onClick={() => void handleTemplateDownload()}>
          Şablonu indir
        </button>
      </div>
      {(errorMessage || templateError) && <p className="op-error-text">{errorMessage || templateError}</p>}
    </div>
  )
}
