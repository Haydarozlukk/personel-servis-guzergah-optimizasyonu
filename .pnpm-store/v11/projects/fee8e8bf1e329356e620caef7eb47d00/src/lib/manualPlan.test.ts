import { describe, expect, it } from 'vitest'
import type { ScenarioResult } from './api'
import { assignPerson, assignPersonToStop, deleteUnassignedPerson, moveStop, unassignPerson, updateVehicle, vehicleHasAvailableSeat } from './manualPlan'

function plan(): ScenarioResult {
  return {
    id: 'scenario-1', name: 'Plan', status: 'completed', deadlineSeconds: 30600,
    workplace: [32.9, 39.9],
    persons: [
      { id: 'p1', name: 'Bir', location: [32.81, 39.91] },
      { id: 'p2', name: 'İki', location: [32.82, 39.92] },
    ],
    vehicles: [
      { id: 'v1', capacity: 18, reservedSeats: 0, effectiveCapacity: 18, start: null, plate: null },
      { id: 'v2', capacity: 30, reservedSeats: 2, effectiveCapacity: 28, start: null, plate: null },
    ],
    stops: [{
      id: 's1', location: [32.81, 39.91], assignedPersonIds: ['p1'],
      walkingDistancesMeters: { p1: 0 }, walkingDurationsSeconds: { p1: 0 },
      demand: 1, qualityScore: 1, averageWalkingDistanceMeters: 0,
    }],
    routes: [{ vehicleId: 'v1', distanceMeters: 100, durationSeconds: 20, load: 1, geometry: '', stopIds: ['s1'], steps: [], arrivalSeconds: 0, deadlineMet: true }],
    unassignedPersonIds: ['p2'],
    unassignedPersons: [{ id: 'p2', reason: 'manual_unassigned' }],
    warnings: [],
  }
}

describe('manual plan operations', () => {
  it('moves a person to a selected service without running an algorithm', () => {
    const next = assignPerson(plan(), 'p2', 'v2')
    expect(next.unassignedPersonIds).not.toContain('p2')
    expect(next.routes.find((route) => route.vehicleId === 'v2')?.load).toBe(1)
    expect(next.stops.some((stop) => stop.assignedPersonIds.includes('p2'))).toBe(true)
  })

  it('unassigns first and only then allows permanent deletion', () => {
    const unassigned = unassignPerson(plan(), 'p1')
    expect(unassigned.unassignedPersonIds).toContain('p1')
    expect(unassigned.stops.some((stop) => stop.assignedPersonIds.includes('p1'))).toBe(false)
    const deleted = deleteUnassignedPerson(unassigned, 'p1')
    expect(deleted.persons.some((person) => person.id === 'p1')).toBe(false)
  })

  it('recalculates effective capacity when reserved seats change', () => {
    const next = updateVehicle(plan(), 'v1', { capacity: 30, reservedSeats: 4 })
    expect(next.vehicles.find((vehicle) => vehicle.id === 'v1')?.effectiveCapacity).toBe(26)
  })

  it('keeps user-defined stop order', () => {
    const assigned = assignPerson(plan(), 'p2', 'v1')
    const secondStop = assigned.routes[0].stopIds[1]
    const reordered = moveStop(assigned, 'v1', secondStop, -1)
    expect(reordered.routes[0].stopIds[0]).toBe(secondStop)
  })

  it('does not assign a passenger to a service at effective capacity', () => {
    const withPassenger = assignPerson(plan(), 'p2', 'v2')
    const fullTarget = updateVehicle(withPassenger, 'v2', { reservedSeats: 29 })

    expect(vehicleHasAvailableSeat(fullTarget, 'v2')).toBe(false)
    expect(assignPerson(fullTarget, 'p1', 'v2')).toBe(fullTarget)
    const targetStop = fullTarget.routes.find((route) => route.vehicleId === 'v2')!.stopIds[0]
    expect(assignPersonToStop(fullTarget, 'p1', targetStop)).toBe(fullTarget)
  })

  it('does not reduce effective capacity below the current passenger count', () => {
    const current = assignPerson(plan(), 'p2', 'v2')
    expect(updateVehicle(current, 'v2', { capacity: 18, reservedSeats: 18 })).toBe(current)
  })
})
