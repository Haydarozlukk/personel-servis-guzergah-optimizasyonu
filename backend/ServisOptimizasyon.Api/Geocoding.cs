using System.Collections.Concurrent;
using System.Net.Http.Json;
using System.Text.Json.Serialization;
using System.Text.RegularExpressions;

public sealed record GeocodingOptions
{
    public string BaseUrl { get; init; } = string.Empty;
    public string PublicBaseUrl { get; init; } = string.Empty;
    public string PublicViewbox { get; init; } = "32.60,40.05,33.05,39.75";
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
    private readonly SemaphoreSlim _publicRequestGate = new(1, 1);
    private DateTimeOffset _lastPublicRequest = DateTimeOffset.MinValue;

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

        foreach (var query in BuildQueries(normalized))
        {
            var result = !string.IsNullOrWhiteSpace(options.PublicBaseUrl)
                ? await SearchPublicAsync(query, cancellationToken)
                : null;
            result ??= await SearchAsync(query, options.BaseUrl, false, cancellationToken);
            if (result is null)
                continue;

            _cache.TryAdd(normalized, result);
            return result;
        }

        return null;
    }

    private static IEnumerable<string> BuildQueries(string address)
    {
        var withoutBuildingNumber = RemoveBuildingNumber(address);
        var standardized = StandardizeAddress(withoutBuildingNumber);
        var streetOnly = RemovePremiseAfterStreetName(standardized);
        var streetFirst = PutStreetFirst(streetOnly);

        return new[] { address, withoutBuildingNumber, standardized, streetOnly, streetFirst }
            .Where(value => !string.IsNullOrWhiteSpace(value))
            .Distinct(StringComparer.OrdinalIgnoreCase);
    }

    private async Task<GeocodingResult?> SearchPublicAsync(
        string query,
        CancellationToken cancellationToken)
    {
        await _publicRequestGate.WaitAsync(cancellationToken);
        try
        {
            var remaining = TimeSpan.FromSeconds(1) - (DateTimeOffset.UtcNow - _lastPublicRequest);
            if (remaining > TimeSpan.Zero)
                await Task.Delay(remaining, cancellationToken);

            var result = await SearchAsync(query, options.PublicBaseUrl, true, cancellationToken);
            _lastPublicRequest = DateTimeOffset.UtcNow;
            return result;
        }
        finally
        {
            _publicRequestGate.Release();
        }
    }

    private async Task<GeocodingResult?> SearchAsync(
        string query,
        string baseUrl,
        bool restrictToPublicViewbox,
        CancellationToken cancellationToken)
    {
        var queryString = $"search?format=jsonv2&limit=5&addressdetails=0"
            + $"&countrycodes={Uri.EscapeDataString(options.CountryCodes)}"
            + $"&q={Uri.EscapeDataString(query)}";
        if (restrictToPublicViewbox)
            queryString += $"&viewbox={Uri.EscapeDataString(options.PublicViewbox)}&bounded=1";

        var url = new Uri(new Uri(baseUrl.TrimEnd('/') + "/"), queryString);
        using var response = await client.GetAsync(url, cancellationToken);
        response.EnsureSuccessStatusCode();
        var candidates = await response.Content.ReadFromJsonAsync<List<NominatimCandidate>>(
            cancellationToken: cancellationToken) ?? [];

        foreach (var candidate in candidates.Where(candidate => IsPlausibleMatch(query, candidate.DisplayName)))
        {
            if (double.TryParse(candidate.Lon, System.Globalization.CultureInfo.InvariantCulture, out var longitude)
                && double.TryParse(candidate.Lat, System.Globalization.CultureInfo.InvariantCulture, out var latitude))
                return new GeocodingResult(longitude, latitude, candidate.DisplayName ?? query);
        }

        return null;
    }

    /// <summary>
    /// Nominatim kimi eksik adreslerde yalnızca şehir benzerliğine göre bambaşka
    /// bir caddeyi ilk sıraya koyabiliyor. Sorgudaki ayırt edici yol/mahalle
    /// parçalarını sonuçla karşılaştırarak bariz yanlış eşleşmeleri eleriz.
    /// </summary>
    private static bool IsPlausibleMatch(string query, string? displayName)
    {
        if (string.IsNullOrWhiteSpace(displayName))
            return false;

        var queryTokens = DistinctiveTokens(query);
        if (queryTokens.Count == 0)
            return true;

        var resultTokens = DistinctiveTokens(displayName);
        var queryNumbers = queryTokens.Where(token => token.All(char.IsDigit)).ToHashSet();
        if (queryNumbers.Count > 0)
        {
            var resultNumbers = resultTokens.Where(token => token.All(char.IsDigit)).ToHashSet();
            if (!queryNumbers.Overlaps(resultNumbers))
                return false;

            var queryWords = queryTokens.Where(token => !token.All(char.IsDigit)).ToHashSet();
            return queryWords.Count == 0 || queryWords.Overlaps(resultTokens);
        }

        return queryTokens.Overlaps(resultTokens);
    }

    private static HashSet<string> DistinctiveTokens(string value)
    {
        var ascii = value.ToUpperInvariant()
            .Replace('Ç', 'C')
            .Replace('Ğ', 'G')
            .Replace('İ', 'I')
            .Replace('Ö', 'O')
            .Replace('Ş', 'S')
            .Replace('Ü', 'U');
        var tokens = Regex.Split(ascii, @"[^A-Z0-9]+")
            .Where(token => token.Length >= 4 || (token.Length >= 3 && token.All(char.IsDigit)))
            .Where(token => !AddressNoiseTokens.Contains(token));
        return new HashSet<string>(tokens, StringComparer.Ordinal);
    }

    private static readonly HashSet<string> AddressNoiseTokens = new(StringComparer.Ordinal)
    {
        "ANKARA", "TURKIYE", "MAHALLE", "MAHALLESI", "CADDE", "CADDESI",
        "SOKAK", "SOKAGI", "BULVAR", "BULVARI", "BLOK", "BLOCK", "SITE",
        "SITESI", "APT", "APARTMAN", "PLAZA", "NUMARA",
    };

    private static string RemoveBuildingNumber(string address)
    {
        var value = Regex.Replace(
            address,
            @"\s+(?:No|Numara)\s*[:.]?\s*\d+[A-Za-zÇĞİÖŞÜçğıöşü/-]*",
            string.Empty,
            RegexOptions.IgnoreCase | RegexOptions.CultureInvariant);
        return Regex.Replace(value, @"\s+,", ",").Trim();
    }

    private static string StandardizeAddress(string address)
    {
        var value = Regex.Replace(address, @"\b\d{5}\b", string.Empty);
        value = value.Replace("/", ", ", StringComparison.Ordinal);
        value = Regex.Replace(value, @"\bBlv\b\.?", "Bulvarı", RegexOptions.IgnoreCase);
        value = Regex.Replace(value, @"\bBlock\b", "Blok", RegexOptions.IgnoreCase);
        value = Regex.Replace(value, @"\s*,\s*", ", ");
        return Regex.Replace(value, @"(?:,\s*){2,}", ", ").Trim(' ', ',');
    }

    private static string RemovePremiseAfterStreetName(string address) => Regex.Replace(
        address,
        @"(?<street>[^,]*?\b(?:Bulvarı|Bulvar|Cadde|Caddesi|Sokak|Sokağı))\s+[^,]+",
        "${street}",
        RegexOptions.IgnoreCase | RegexOptions.CultureInvariant);

    private static string PutStreetFirst(string address)
    {
        var parts = address.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
        var streetIndex = Array.FindIndex(parts, part => Regex.IsMatch(
            part,
            @"\b(?:Bulvarı|Bulvar|Cadde|Caddesi|Sokak|Sokağı)\b",
            RegexOptions.IgnoreCase | RegexOptions.CultureInvariant));

        if (streetIndex <= 0)
            return address;

        return string.Join(", ", new[] { parts[streetIndex] }
            .Concat(parts.Take(streetIndex))
            .Concat(parts.Skip(streetIndex + 1)));
    }

    private static string Normalize(string value) =>
        string.Join(' ', value.Trim().Split(
            [' ', '\t', '\r', '\n'], StringSplitOptions.RemoveEmptyEntries));

    private sealed record NominatimCandidate(
        [property: JsonPropertyName("lon")] string Lon,
        [property: JsonPropertyName("lat")] string Lat,
        [property: JsonPropertyName("display_name")] string? DisplayName);
}
