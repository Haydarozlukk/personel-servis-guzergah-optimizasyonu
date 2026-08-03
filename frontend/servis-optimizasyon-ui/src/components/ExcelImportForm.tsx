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
  const [workplaceLongitude, setWorkplaceLongitude] = useState(32.8541)
  const [workplaceLatitude, setWorkplaceLatitude] = useState(39.9208)
  const [vehicleCount, setVehicleCount] = useState('')
  const [vehicleCapacity, setVehicleCapacity] = useState('')
  const [templateError, setTemplateError] = useState('')

  const canSubmit = !disabled && file !== null

  function handleSubmit() {
    if (!file) return
    onSubmit({
      file,
      name,
      arrivalDeadline,
      workplaceLongitude,
      workplaceLatitude,
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
      <label>Senaryo adı
        <input type="text" value={name} disabled={isBusy} onChange={(event) => setName(event.target.value)} />
      </label>
      <label>Varış saati
        <input
          type="time"
          step="1"
          value={arrivalDeadline}
          disabled={isBusy}
          onChange={(event) => setArrivalDeadline(event.target.value)}
        />
      </label>
      <label>İşyeri boylam
        <input
          type="number"
          step="any"
          value={workplaceLongitude}
          disabled={isBusy}
          onChange={(event) => setWorkplaceLongitude(Number(event.target.value))}
        />
      </label>
      <label>İşyeri enlem
        <input
          type="number"
          step="any"
          value={workplaceLatitude}
          disabled={isBusy}
          onChange={(event) => setWorkplaceLatitude(Number(event.target.value))}
        />
      </label>
      <label>Araç sayısı (araclar sayfası yoksa)
        <input
          type="number"
          min="1"
          value={vehicleCount}
          disabled={isBusy}
          onChange={(event) => setVehicleCount(event.target.value)}
        />
      </label>
      <label>Araç kapasitesi (araclar sayfası yoksa)
        <input
          type="number"
          min="1"
          value={vehicleCapacity}
          disabled={isBusy}
          onChange={(event) => setVehicleCapacity(event.target.value)}
        />
      </label>
      <label>Excel dosyası (.xlsx)
        <input
          type="file"
          accept=".xlsx"
          disabled={isBusy}
          onChange={(event) => setFile(event.target.files?.[0] ?? null)}
        />
      </label>
      <button type="button" disabled={!canSubmit} onClick={handleSubmit}>
        {isBusy && <span className="spinner" aria-hidden="true" />}
        Excel'i yükle ve senaryoyu oluştur
      </button>
      <button type="button" className="secondary" disabled={isBusy} onClick={() => void handleTemplateDownload()}>
        Boş şablon indir
      </button>
      {templateError && <p className="status-error">{templateError}</p>}
    </section>
  )
}
