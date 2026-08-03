// Google/OSRM-compatible encoded polyline codec (precision 5), matching the
// `geometry` field format declared in contracts/openapi.yaml ScenarioResult.route.

export function encodePolyline(points: [number, number][]): string {
  let output = ''
  let prevLat = 0
  let prevLng = 0
  for (const [lat, lng] of points) {
    const lat5 = Math.round(lat * 1e5)
    const lng5 = Math.round(lng * 1e5)
    output += encodeValue(lat5 - prevLat) + encodeValue(lng5 - prevLng)
    prevLat = lat5
    prevLng = lng5
  }
  return output
}

function encodeValue(value: number): string {
  let v = value < 0 ? ~(value << 1) : value << 1
  let output = ''
  while (v >= 0x20) {
    output += String.fromCharCode((0x20 | (v & 0x1f)) + 63)
    v >>= 5
  }
  output += String.fromCharCode(v + 63)
  return output
}

export function decodePolyline(encoded: string): [number, number][] {
  const points: [number, number][] = []
  let index = 0
  let lat = 0
  let lng = 0
  while (index < encoded.length) {
    let result = 0
    let shift = 0
    let byte: number
    do {
      byte = encoded.charCodeAt(index++) - 63
      result |= (byte & 0x1f) << shift
      shift += 5
    } while (byte >= 0x20)
    lat += result & 1 ? ~(result >> 1) : result >> 1

    result = 0
    shift = 0
    do {
      byte = encoded.charCodeAt(index++) - 63
      result |= (byte & 0x1f) << shift
      shift += 5
    } while (byte >= 0x20)
    lng += result & 1 ? ~(result >> 1) : result >> 1

    points.push([lat / 1e5, lng / 1e5])
  }
  return points
}
