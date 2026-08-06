type TopActionButtonsProps = {
  onOpenExcel: () => void
  onOpenPerson: () => void
  onSaveVersion: () => void
  onOpenVersions: () => void
  onExport: () => void
  onFullReoptimize: () => void
  onNearbyServices: () => void
  onAdmin?: () => void
  onLogout: () => void
}

export function TopActionButtons({ onOpenExcel, onOpenPerson, onSaveVersion, onOpenVersions, onExport, onFullReoptimize, onNearbyServices, onAdmin, onLogout }: TopActionButtonsProps) {
  return (
    <div className="op-top-buttons">
      <button type="button" className="op-btn op-btn-primary" onClick={onOpenExcel}>
        Excel Aktar
      </button>
      <button type="button" className="op-btn op-btn-secondary" onClick={onOpenPerson}>
        Kişi Ekle
      </button>
      <button type="button" className="op-btn op-btn-secondary" onClick={onSaveVersion}>Versiyon Kaydet</button>
      <button type="button" className="op-btn op-btn-secondary" onClick={onOpenVersions}>Versiyonlar</button>
      <button type="button" className="op-btn op-btn-secondary" onClick={onExport}>Dışa Aktar</button>
      <button type="button" className="op-btn op-btn-secondary" onClick={onFullReoptimize}>Tam Optimize</button>
      <button type="button" className="op-btn op-btn-secondary" onClick={onNearbyServices}>Yakın Servis</button>
      {onAdmin && <button type="button" className="op-btn op-btn-secondary" onClick={onAdmin}>Admin</button>}
      <button type="button" className="op-btn op-btn-secondary" onClick={onLogout}>Çıkış</button>
    </div>
  )
}
