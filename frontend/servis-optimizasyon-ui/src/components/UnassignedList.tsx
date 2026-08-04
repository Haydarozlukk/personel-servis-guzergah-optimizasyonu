type UnassignedPersonView = { id: string; name: string; reason: string | null }

type UnassignedListProps = {
  persons: UnassignedPersonView[]
}

export function UnassignedList({ persons }: UnassignedListProps) {
  if (persons.length === 0) return null

  return (
    <section className="unassigned-list" aria-label="Atanamayan personel">
      <div className="result-card-header">
        <div>
          <p className="section-kicker">Kontrol gerekli</p>
          <h2>Atanamayan personel</h2>
        </div>
        <strong>{persons.length} kişi</strong>
      </div>
      <ul>
        {persons.map((person) => (
          <li key={person.id}>{person.name}{person.reason ? ` — ${person.reason}` : ''}</li>
        ))}
      </ul>
    </section>
  )
}
