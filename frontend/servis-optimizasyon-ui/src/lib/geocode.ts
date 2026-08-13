import { getGeocodingSuggestions } from './api'

export type GeocodeResult = { lat: number; lon: number }

// Backend'in Ankara'ya özel, IMPORT_STYLE=address ile kurulan yerel Nominatim'i
// ve TurkishAddressParser'ı üzerinden arar; bina no'ya kadar hassasiyet ve
// gerçek personel adreslerinin dışarı çıkmaması (kararlar.md) bu sayede sağlanır.
export async function geocodeAddress(query: string): Promise<GeocodeResult> {
  let suggestions: Awaited<ReturnType<typeof getGeocodingSuggestions>>
  try {
    suggestions = await getGeocodingSuggestions(query)
  } catch {
    throw new Error('Adres aranırken hata oluştu.')
  }
  if (!suggestions.length) throw new Error('Adres bulunamadı, tekrar deneyin.')
  const [longitude, latitude] = suggestions[0].location
  return { lat: latitude, lon: longitude }
}
