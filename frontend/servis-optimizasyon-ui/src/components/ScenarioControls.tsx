type ScenarioControlsProps = {
  personCount: number
  vehicleCount: number
  vehicleCapacity: number
  onPersonCountChange: (value: number) => void
  onVehicleCountChange: (value: number) => void
  onVehicleCapacityChange: (value: number) => void
  onSubmit: () => void
  disabled: boolean
  isBusy: boolean
  validationErrors: string[]
  capacityWarning: string | null
}

export function ScenarioControls({
  personCount,
  vehicleCount,
  vehicleCapacity,
  onPersonCountChange,
  onVehicleCountChange,
  onVehicleCapacityChange,
  onSubmit,
  disabled,
  isBusy,
  validationErrors,
  capacityWarning,
}: ScenarioControlsProps) {
  return (
    <>
      <section className="controls" aria-label="Senaryo girdileri">
        <label>
          <span>Personel sayısı</span>
          <input
            type="number"
            min="1"
            value={personCount}
            disabled={isBusy}
            onChange={(event) => onPersonCountChange(Number(event.target.value))}
          />
        </label>
        <label>
          <span>Araç sayısı</span>
          <input
            type="number"
            min="1"
            value={vehicleCount}
            disabled={isBusy}
            onChange={(event) => onVehicleCountChange(Number(event.target.value))}
          />
        </label>
        <label>
          <span>Araç kapasitesi</span>
          <input
            type="number"
            min="1"
            value={vehicleCapacity}
            disabled={isBusy}
            onChange={(event) => onVehicleCapacityChange(Number(event.target.value))}
          />
        </label>
        <button className="primary-action" type="button" disabled={disabled} onClick={onSubmit}>
          {isBusy && <span className="spinner" aria-hidden="true" />}
          {isBusy ? 'Planlanıyor…' : 'Rotayı optimize et'}
          {!isBusy && <span className="button-arrow" aria-hidden="true">→</span>}
        </button>
      </section>
      {validationErrors.length > 0 && <p className="status-error">{validationErrors.join(' ')}</p>}
      {capacityWarning && <p className="status-warning">{capacityWarning}</p>}
    </>
  )
}
