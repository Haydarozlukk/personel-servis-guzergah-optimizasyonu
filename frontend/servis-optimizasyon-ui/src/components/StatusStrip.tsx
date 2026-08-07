import type { StopGenerationSummary } from '../lib/api'

export type StatusTone = 'neutral' | 'progress' | 'success' | 'error'

type StatusStripProps = {
  tone: StatusTone
  message: string
  warnings: string[]
  unassignedPersonCount: number
  stopSummary: StopGenerationSummary | null
}

export function StatusStrip({ tone, message, warnings, unassignedPersonCount, stopSummary }: StatusStripProps) {
  return (
    <div className={`op-status-strip op-scroll op-status-${tone}`} aria-live="polite">
      <div className="op-status-row">
        <span className="op-status-icon" aria-hidden="true" />
        <span>{message}</span>
      </div>
      {warnings.length > 0 && <p className="op-status-warning">{warnings.join(' ')}</p>}
      {unassignedPersonCount > 0 && (
        <p className="op-status-warning">{unassignedPersonCount} personel atanamadı.</p>
      )}
      {stopSummary && (
        <div className="op-status-walking">
          <span>
            {stopSummary.averageWalkingDistanceMeters != null
              ? `${Math.round(stopSummary.averageWalkingDistanceMeters)} m ortalama yürüme`
              : 'Yürüme verisi bekleniyor'}
          </span>
          <div className="op-status-walking-bar">
            <i style={{ width: `${Math.min(100, ((stopSummary.averageWalkingDistanceMeters ?? 0) / 500) * 100)}%` }} />
          </div>
        </div>
      )}
    </div>
  )
}
