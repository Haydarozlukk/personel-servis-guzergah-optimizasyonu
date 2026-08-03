type UnassignedPersonView = { id: string; name: string; reason: string | null }

type UnassignedListProps = {
  persons: UnassignedPersonView[]
}

export function UnassignedList({ persons }: UnassignedListProps) {
  if (persons.length === 0) return null

  return (
    <section className="unassigned-list" aria-label="Atanamayan personel">
      <h2>Atanamayan personel ({persons.length})</h2>
      <ul>
        {persons.map((person) => (
          <li key={person.id}>{person.name}{person.reason ? ` — ${person.reason}` : ''}</li>
        ))}
      </ul>
    </section>
  )
}
