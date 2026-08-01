export type PersonPoint = { id: string; name: string; position: [number, number] }

export const mockWorkplace: [number, number] = [39.9208, 32.8541]

export function createMockPersons(count: number): PersonPoint[] {
  return Array.from({ length: count }, (_, index) => {
    const angle = index * 2.39996
    const radius = 0.004 + (index % 7) * 0.0012
    return {
      id: `person-${String(index + 1).padStart(3, '0')}`,
      name: `Personel ${String(index + 1).padStart(3, '0')}`,
      position: [
        mockWorkplace[0] + Math.cos(angle) * radius,
        mockWorkplace[1] + Math.sin(angle) * radius,
      ],
    }
  })
}
