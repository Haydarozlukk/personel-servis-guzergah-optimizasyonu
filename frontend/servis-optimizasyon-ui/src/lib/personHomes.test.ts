import { describe, expect, it } from 'vitest'
import { buildPersonHomes, UNASSIGNED_HOME_COLOR } from './personHomes'
import type { ScenarioResult, ScenarioStop } from './api'
import type { RouteLike } from './routeLike'

type Person = ScenarioResult['persons'][number]

function person(id: string, longitude = 32.8, latitude = 39.9, name?: string): Person {
  return { id, name, location: [longitude, latitude] } as Person
}

function stop(id: string, assignedPersonIds: string[]): ScenarioStop {
  return {
    id,
    location: [32.8, 39.9],
    assignedPersonIds,
    walkingDistancesMeters: {},
    walkingDurationsSeconds: {},
    demand: assignedPersonIds.length,
    qualityScore: 1,
    averageWalkingDistanceMeters: 0,
  } as ScenarioStop
}

function route(vehicleId: string, stopIds: string[], steps?: { stopId: string }[]): RouteLike {
  return {
    vehicleId,
    distanceMeters: 0,
    durationSeconds: 0,
    load: 0,
    geometry: '',
    stopIds,
    steps,
  }
}

const colors = new Map([['Servis-001', '#1d4ed8'], ['Servis-002', '#7c3aed']])

describe('buildPersonHomes', () => {
  it('colors each home with the colour of the service that picks it up', () => {
    const homes = buildPersonHomes({
      persons: [person('p1'), person('p2')],
      stops: [stop('s1', ['p1']), stop('s2', ['p2'])],
      routes: [route('Servis-001', ['s1']), route('Servis-002', ['s2'])],
      vehicleColors: colors,
      selectedVehicleId: null,
    })

    expect(homes.map((home) => [home.id, home.vehicleId, home.color])).toEqual([
      ['p1', 'Servis-001', '#1d4ed8'],
      ['p2', 'Servis-002', '#7c3aed'],
    ])
  })

  it('joins stops reachable only through route steps', () => {
    const homes = buildPersonHomes({
      persons: [person('p1')],
      stops: [stop('s1', ['p1'])],
      routes: [route('Servis-001', [], [{ stopId: 's1' }])],
      vehicleColors: colors,
      selectedVehicleId: null,
    })

    expect(homes[0].vehicleId).toBe('Servis-001')
  })

  it('greys out a person whose stop belongs to no route', () => {
    const homes = buildPersonHomes({
      persons: [person('p1')],
      stops: [stop('orphan', ['p1'])],
      routes: [route('Servis-001', ['s1'])],
      vehicleColors: colors,
      selectedVehicleId: null,
    })

    expect(homes[0].vehicleId).toBeNull()
    expect(homes[0].color).toBe(UNASSIGNED_HOME_COLOR)
  })

  it('greys out a person who is on no stop at all', () => {
    const homes = buildPersonHomes({
      persons: [person('unassigned')],
      stops: [],
      routes: [],
      vehicleColors: colors,
      selectedVehicleId: null,
    })

    expect(homes[0].color).toBe(UNASSIGNED_HOME_COLOR)
  })

  it('assigns a duplicated person to the first route deterministically', () => {
    const homes = buildPersonHomes({
      persons: [person('p1')],
      stops: [stop('s1', ['p1']), stop('s2', ['p1'])],
      routes: [route('Servis-001', ['s1']), route('Servis-002', ['s2'])],
      vehicleColors: colors,
      selectedVehicleId: null,
    })

    expect(homes).toHaveLength(1)
    expect(homes[0].vehicleId).toBe('Servis-001')
  })

  it('keeps only the selected service and hides unassigned people', () => {
    const homes = buildPersonHomes({
      persons: [person('p1'), person('p2'), person('nobody')],
      stops: [stop('s1', ['p1']), stop('s2', ['p2'])],
      routes: [route('Servis-001', ['s1']), route('Servis-002', ['s2'])],
      vehicleColors: colors,
      selectedVehicleId: 'Servis-002',
    })

    expect(homes.map((home) => home.id)).toEqual(['p2'])
  })

  it('converts API [longitude, latitude] into Leaflet [latitude, longitude]', () => {
    const homes = buildPersonHomes({
      persons: [person('p1', 32.6665836, 39.8695189)],
      stops: [],
      routes: [],
      vehicleColors: colors,
      selectedVehicleId: null,
    })

    expect(homes[0].position).toEqual([39.8695189, 32.6665836])
  })

  it('skips people whose coordinates are missing or malformed', () => {
    const homes = buildPersonHomes({
      persons: [
        { id: 'broken', location: [] } as unknown as Person,
        { id: 'nan', location: [Number.NaN, 39.9] } as unknown as Person,
        person('ok'),
      ],
      stops: [],
      routes: [],
      vehicleColors: colors,
      selectedVehicleId: null,
    })

    expect(homes.map((home) => home.id)).toEqual(['ok'])
  })

  it('falls back to a concrete colour when a routed vehicle has no palette entry', () => {
    const homes = buildPersonHomes({
      persons: [person('p1')],
      stops: [stop('s1', ['p1'])],
      routes: [route('Servis-099', ['s1'])],
      vehicleColors: new Map(),
      selectedVehicleId: null,
    })

    expect(homes[0].vehicleId).toBe('Servis-099')
    expect(homes[0].color).toBe(UNASSIGNED_HOME_COLOR)
  })
})
