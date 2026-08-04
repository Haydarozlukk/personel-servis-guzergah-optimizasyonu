using System.Collections.Concurrent;
using System.Net.Http.Json;
using System.Text.Json.Serialization;

public sealed record GeocodingOptions
{
    public string BaseUrl { get; init; } = string.Empty;
    public string CountryCodes { get; init; } = "tr";
    public int MaxConcurrency { get; init; } = 3;
}

public sealed record GeocodingResult(double Longitude, double Latitude, string DisplayName);

public interface IGeocodingService
{
    Task<GeocodingResult?> GeocodeAsync(string address, CancellationToken cancellationToken);
}

/// <summary>
/// Yalnızca yapılandırılmış Nominatim uyumlu servise bağlanır. Bilerek public
/// varsayılan URL içermez; gerçek personel adresleri yanlışlıkla dışarı çıkmaz.
/// </summary>
public sealed class NominatimGeocodingService(
    HttpClient client,
    GeocodingOptions options) : IGeocodingService
{
    private readonly ConcurrentDictionary<string, GeocodingResult> _cache =
        new(StringComparer.OrdinalIgnoreCase);

    public async Task<GeocodingResult?> GeocodeAsync(
        string address,
        CancellationToken cancellationToken)
    {
        var normalized = Normalize(address);
        if (_cache.TryGetValue(normalized, out var cached))
            return cached;

        if (string.IsNullOrWhiteSpace(options.BaseUrl))
            throw new InvalidOperationException(
                "Geocoding servisi yapılandırılmamış. Geocoding:BaseUrl ayarlanmalıdır.");

        var url = $"search?format=jsonv2&limit=1&addressdetails=0"
            + $"&countrycodes={Uri.EscapeDataString(options.CountryCodes)}"
            + $"&q={Uri.EscapeDataString(normalized)}";
        using var response = await client.GetAsync(url, cancellationToken);
        response.EnsureSuccessStatusCode();
        var candidates = await response.Content.ReadFromJsonAsync<List<NominatimCandidate>>(
            cancellationToken: cancellationToken) ?? [];

        var first = candidates.FirstOrDefault();
        if (first is null
            || !double.TryParse(first.Lon, System.Globalization.CultureInfo.InvariantCulture, out var longitude)
            || !double.TryParse(first.Lat, System.Globalization.CultureInfo.InvariantCulture, out var latitude))
            return null;

        var result = new GeocodingResult(longitude, latitude, first.DisplayName ?? normalized);
        _cache.TryAdd(normalized, result);
        return result;
    }

    private static string Normalize(string value) =>
        string.Join(' ', value.Trim().Split(
            [' ', '\t', '\r', '\n'], StringSplitOptions.RemoveEmptyEntries));

    private sealed record NominatimCandidate(
        [property: JsonPropertyName("lon")] string Lon,
        [property: JsonPropertyName("lat")] string Lat,
        [property: JsonPropertyName("display_name")] string? DisplayName);
}
