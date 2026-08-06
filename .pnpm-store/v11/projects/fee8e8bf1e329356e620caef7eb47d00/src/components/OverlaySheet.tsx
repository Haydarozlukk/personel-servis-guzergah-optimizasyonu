import type { ReactNode } from 'react'

type OverlaySheetProps = {
  kicker: string
  title: string
  onClose: () => void
  children: ReactNode
}

export function OverlaySheet({ kicker, title, onClose, children }: OverlaySheetProps) {
  return (
    <div className="op-sheet op-scroll">
      <div className="op-sheet-header">
        <div>
          <p className="op-kicker">{kicker}</p>
          <h2>{title}</h2>
        </div>
        <button type="button" className="op-close" aria-label="Kapat" onClick={onClose}>
          ×
        </button>
      </div>
      {children}
    </div>
  )
}
