type TopActionButtonsProps = {
  onOpenExcel: () => void
  onOpenPerson: () => void
}

export function TopActionButtons({ onOpenExcel, onOpenPerson }: TopActionButtonsProps) {
  return (
    <div className="op-top-buttons">
      <button type="button" className="op-btn op-btn-primary" onClick={onOpenExcel}>
        Excel Aktar
      </button>
      <button type="button" className="op-btn op-btn-secondary" onClick={onOpenPerson}>
        Kişi Ekle
      </button>
    </div>
  )
}
