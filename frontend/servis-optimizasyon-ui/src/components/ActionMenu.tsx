import { useState, type ReactNode } from 'react'

type ActionMenuProps = {
  onOpenAdd: () => void
  onOpenVersions: () => void
  onExport: () => void
  onFullReoptimize?: () => void
  onLogout: () => void
}

function PersonPlusIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6z" />
      <path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6" />
      <path d="M18 8v6M15 11h6" />
    </svg>
  )
}

function HistoryIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 8v4l3 2" />
      <circle cx="12" cy="12" r="9" />
    </svg>
  )
}

function DownloadIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 3v12M7 10l5 5 5-5" />
      <path d="M4 19h16" />
    </svg>
  )
}

function BoltIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M13 2 4 14h6l-1 8 9-12h-6l1-8z" />
    </svg>
  )
}

function LogoutIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <path d="M16 17l5-5-5-5M21 12H9" />
    </svg>
  )
}

export function ActionMenu({ onOpenAdd, onOpenVersions, onExport, onFullReoptimize, onLogout }: ActionMenuProps) {
  const [open, setOpen] = useState(false)

  function run(action: () => void) {
    action()
    setOpen(false)
  }

  const items: { key: string; label: string; icon: ReactNode; onClick: () => void; danger?: boolean }[] = [
    { key: 'add', label: 'Kişi Ekle', icon: <PersonPlusIcon />, onClick: () => run(onOpenAdd) },
    { key: 'versions', label: 'Versiyonlar', icon: <HistoryIcon />, onClick: () => run(onOpenVersions) },
    { key: 'export', label: 'Dışa Aktar', icon: <DownloadIcon />, onClick: () => run(onExport) },
    ...(onFullReoptimize ? [{ key: 'optimize', label: 'Tam Optimize', icon: <BoltIcon />, onClick: () => run(onFullReoptimize) }] : []),
    { key: 'logout', label: 'Çıkış', icon: <LogoutIcon />, onClick: () => run(onLogout), danger: true },
  ]

  return (
    <div className="op-action-menu">
      <button
        type="button"
        className={`op-action-trigger${open ? ' open' : ''}`}
        aria-label={open ? 'Aksiyon menüsünü kapat' : 'Aksiyon menüsünü aç'}
        aria-expanded={open}
        onClick={() => setOpen((prev) => !prev)}
      >
        <span className="op-action-trigger-bars"><i /><i /><i /></span>
      </button>
      {open && (
        <div className="op-action-list" role="menu">
          {items.map((item) => (
            <button key={item.key} type="button" className={`op-action-item${item.danger ? ' danger' : ''}`} role="menuitem" onClick={item.onClick}>
              <span className="op-action-item-circle">{item.icon}</span>
              <span className="op-action-item-label">{item.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
