import { useEffect, useState } from 'react'
import type { ScenarioStop } from './api'

const addressCache = new Map<string, string>()

export function getStopDisplayName(
  stop: ScenarioStop,
  personMap?: Map<string, { id: string; name?: string; location: number[] }>,
  index?: number
): string {
  if (personMap && stop.assignedPersonIds && stop.assignedPersonIds.length > 0) {
    const assignedNames = stop.assignedPersonIds
      .map((id) => personMap.get(id)?.name)
      .filter((name): name is string => !!name && name.trim().length > 0)

    if (assignedNames.length === 1) {
      return `${assignedNames[0]} Durağı`
    }
    if (assignedNames.length > 1) {
      if (assignedNames.length === 2) {
        return `${assignedNames[0]} & ${assignedNames[1]} Durağı`
      }
      return `${assignedNames[0]} (+${assignedNames.length - 1} kişi)`
    }
  }

  if (typeof index === 'number') {
    return `Durak #${index + 1}`
  }

  if (stop.id.startsWith('stop-candidate-')) {
    const num = stop.id.replace('stop-candidate-', '').replace(/^0+/, '')
    return `Durak #${num}`
  }

  if (stop.id.startsWith('manuel-durak-')) {
    return `Manuel Durak`
  }

  return stop.id
}

export function useStopAddress(location: number[]): string {
  const [address, setAddress] = useState<string>('')

  useEffect(() => {
    if (!location || location.length < 2) return
    const lng = location[0]
    const lat = location[1]
    const key = `${lat.toFixed(4)},${lng.toFixed(4)}`

    if (addressCache.has(key)) {
      setAddress(addressCache.get(key)!)
      return
    }

    const controller = new AbortController()
    fetch(`https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json&zoom=17`, {
      headers: { 'Accept-Language': 'tr' },
      signal: controller.signal,
    })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!data) return
        const addr = data.address
        const street =
          addr?.road ||
          addr?.pedestrian ||
          addr?.street ||
          addr?.suburb ||
          addr?.neighbourhood ||
          data.display_name?.split(',')[0]
        if (street) {
          addressCache.set(key, street)
          setAddress(street)
        }
      })
      .catch(() => {})

    return () => controller.abort()
  }, [location])

  return address
}
