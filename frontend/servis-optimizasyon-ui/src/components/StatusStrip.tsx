import { useState } from 'react'
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
  const [expanded, setExpanded] = useState(false)

  return (
    <div className={`op-status-strip op-status-${tone}`} aria-live="polite">
      <div className="op-status-row">
        <span className="op-status-icon" aria-hidden="true" />
        <span>{message}</span>
      </div>
      {unassignedPersonCount > 0 && (
        <p className="op-status-warning">{unassignedPersonCount} personel atanamadı.</p>
      )}
      {warnings.length > 0 && (
        <div className="op-status-warnings">
          <button
            type="button"
            className="op-status-warnings-toggle"
            onClick={() => setExpanded((prev) => !prev)}
            aria-expanded={expanded}
          >
            ⚠ {warnings.length} uyarı {expanded ? '· gizle ▲' : '· detaylar ▼'}
          </button>
          {expanded && (
            <ul className="op-status-warnings-list op-scroll">
              {warnings.map((warning, index) => (
                <li key={index}>{warning}</li>
              ))}
            </ul>
          )}
        </div>
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
