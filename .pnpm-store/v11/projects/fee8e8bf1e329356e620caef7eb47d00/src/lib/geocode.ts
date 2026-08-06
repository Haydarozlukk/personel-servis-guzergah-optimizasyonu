export type GeocodeResult = { lat: number; lon: number }

export async function geocodeAddress(query: string): Promise<GeocodeResult> {
  let response: Response
  try {
    response = await fetch(
      `https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=tr&q=${encodeURIComponent(`${query}, Ankara`)}`,
    )
  } catch {
    throw new Error('Adres aranırken hata oluştu.')
  }
  if (!response.ok) throw new Error('Adres aranırken hata oluştu.')
  const data = (await response.json()) as Array<{ lat: string; lon: string }>
  if (!data.length) throw new Error('Adres bulunamadı, tekrar deneyin.')
  return { lat: parseFloat(data[0].lat), lon: parseFloat(data[0].lon) }
}
