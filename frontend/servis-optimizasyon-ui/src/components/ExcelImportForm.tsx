import { useState } from 'react'
import { downloadImportTemplate, type ExcelImportForm as ExcelImportFormData } from '../lib/api'

type ExcelImportFormProps = {
  onSubmit: (form: ExcelImportFormData) => void
  disabled: boolean
  isBusy: boolean
}

export function ExcelImportForm({ onSubmit, disabled, isBusy }: ExcelImportFormProps) {
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
    <section className="controls excel-import" aria-label="Excel'den senaryo yükle">
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
      <label className="file-field">
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
      <label className="file-field">
        <span>Excel dosyası <small>.xlsx</small></span>
        <input
          type="file"
          accept=".xlsx"
          disabled={isBusy}
          onChange={(event) => setFile(event.target.files?.[0] ?? null)}
        />
      </label>
      <div className="excel-actions">
        <button className="primary-action" type="button" disabled={!canSubmit} onClick={handleSubmit}>
          {isBusy && <span className="spinner" aria-hidden="true" />}
          {isBusy ? 'Planlanıyor…' : "Excel'i yükle ve optimize et"}
          {!isBusy && <span className="button-arrow" aria-hidden="true">→</span>}
        </button>
        <button type="button" className="secondary" disabled={isBusy} onClick={() => void handleTemplateDownload()}>
          Şablonu indir
        </button>
      </div>
      {templateError && <p className="status-error">{templateError}</p>}
    </section>
  )
}
