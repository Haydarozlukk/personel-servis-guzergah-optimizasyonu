import { useState } from 'react'
import { downloadImportTemplate, type ExcelImportForm as ExcelImportFormData } from '../lib/api'

export type ImportMode = 'distribute' | 'full'

type ExcelImportSheetProps = {
  onSubmit: (form: ExcelImportFormData & { mode: ImportMode }) => void
  disabled: boolean
  isBusy: boolean
  errorMessage: string
  hasActivePlan?: boolean
}

export function ExcelImportSheet({ onSubmit, disabled, isBusy, errorMessage, hasActivePlan }: ExcelImportSheetProps) {
  const [file, setFile] = useState<File | null>(null)
  const [name, setName] = useState('Excel senaryosu')
  const [arrivalDeadline, setArrivalDeadline] = useState('08:30:00')
  const [destinationAddress, setDestinationAddress] = useState('')
  const [vehicleCount, setVehicleCount] = useState('')
  const [templateError, setTemplateError] = useState('')
  const [mode, setMode] = useState<ImportMode>(hasActivePlan ? 'distribute' : 'full')

  const canSubmit = !disabled && file !== null

  function handleSubmit() {
    if (!file) return
    onSubmit({
      file,
      name,
      arrivalDeadline,
      destinationAddress: destinationAddress.trim() || undefined,
      vehicleCount: vehicleCount.trim() ? Number(vehicleCount) : undefined,
      mode: hasActivePlan ? mode : 'full',
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
      {hasActivePlan && (
        <div className="op-field-wide op-import-mode-selector" style={{ background: '#f8fafc', padding: '12px 16px', borderRadius: '8px', border: '1px solid #e2e8f0', marginBottom: '12px' }}>
          <span style={{ fontSize: '13px', fontWeight: 600, color: '#334155', display: 'block', marginBottom: '8px' }}>⚡ İçe Aktarma Yönetimi</span>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: '13px', color: '#1e293b' }}>
              <input
                type="radio"
                name="importMode"
                value="distribute"
                checked={mode === 'distribute'}
                onChange={() => setMode('distribute')}
                disabled={isBusy}
              />
              <strong>Mevcut Rotalara Dağıt (Önerilen)</strong> — <span style={{ color: '#64748b' }}>Kişileri adreslerine en yakın araç ve duraklara atar.</span>
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: '13px', color: '#1e293b' }}>
              <input
                type="radio"
                name="importMode"
                value="full"
                checked={mode === 'full'}
                onChange={() => setMode('full')}
                disabled={isBusy}
              />
              <strong>Sıfırdan Tam Optimizasyon</strong> — <span style={{ color: '#64748b' }}>Mevcut rotayı tamamen silip sıfırdan planlar.</span>
            </label>
          </div>
        </div>
      )}

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
        <span>Varış adresi <small>ekrandan veya Excel ayarlar sayfasından</small></span>
        <input
          type="text"
          placeholder="Örn. Kızılırmak Mah. 1443. Cad. No:5, Çankaya/Ankara"
          value={destinationAddress}
          disabled={isBusy}
          onChange={(event) => setDestinationAddress(event.target.value)}
        />
      </label>
      <label className="op-field-wide">
        <span>Araç sayısı <small>boş bırakılırsa otomatik hesaplanır</small></span>
        <input
          type="number"
          min={1}
          step={1}
          placeholder="Örn. 40"
          value={vehicleCount}
          disabled={isBusy}
          onChange={(event) => setVehicleCount(event.target.value)}
        />
      </label>
      {!hasActivePlan && (
        <p className="op-field-wide op-drawer-note">
          {vehicleCount
            ? `Filo, girdiğiniz ${vehicleCount} araca göre kapasitelendirilir; süre/mesafe sınırları uyarıya çevrilir.`
            : 'Araç sayısı boşsa 16 kişilik araçlarla, rota süresi/mesafesi sınırlarına göre otomatik oluşturulur.'}
        </p>
      )}
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
          {isBusy ? 'İşleniyor…' : mode === 'distribute' && hasActivePlan ? 'Yükle ve Adreslere Dağıt →' : 'Yükle ve optimize et →'}
        </button>
        <button type="button" className="op-btn op-btn-secondary" disabled={isBusy} onClick={() => void handleTemplateDownload()}>
          Şablonu indir
        </button>
      </div>
      {(errorMessage || templateError) && <p className="op-error-text">{errorMessage || templateError}</p>}
    </div>
  )
}
