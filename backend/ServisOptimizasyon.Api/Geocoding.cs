using System.Collections.Concurrent;
using System.Net.Http.Json;
using System.Text.Json;
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
    Task<IReadOnlyList<GeocodingSuggestion>> SuggestAsync(
        string query,
        int limit,
        CancellationToken cancellationToken);

    /// <summary>
    /// Bir koordinatın mahallesini (bulunamazsa ilçesini) döndürür, servis
    /// isimlendirme önerisi için. Mahalle tercih edilir çünkü aynı ilçede
    /// duran onlarca araç aksi hâlde birebir aynı etikete düşer.
    /// Bulunamazsa veya servis yapılandırılmamışsa null döner; çağıran taraf bunu
    /// bir hata olarak değil, "öneri üretilemedi" olarak ele almalıdır.
    /// </summary>
    Task<string?> ReverseGeocodeDistrictAsync(double[] location, CancellationToken cancellationToken);
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

    public async Task<IReadOnlyList<GeocodingSuggestion>> SuggestAsync(
        string query,
        int limit,
        CancellationToken cancellationToken)
    {
        var normalized = Normalize(query);
        if (normalized.Length < 3)
            return [];

        if (string.IsNullOrWhiteSpace(options.BaseUrl))
            throw new InvalidOperationException(
                "Geocoding servisi yapılandırılmamış. Geocoding:BaseUrl ayarlanmalıdır.");

        var boundedLimit = Math.Clamp(limit, 1, 5);
        var parts = TurkishAddressParser.Parse(normalized);
        var wantedHouseNumber = NormalizeHouseNumber(parts.HouseNumber);

        // Tek bir serbest metin sorgusu, aradaki bir site/apartman adı gibi
        // gürültülü kelimeler yüzünden kolayca 0 sonuç dönebiliyor (bkz.
        // GeocodeAsync.BuildQueries). Aynı basitleştirme zincirini burada da
        // deneriz; ilk sonuç veren varyantta dururuz.
        var candidates = new List<NominatimCandidate>();
        foreach (var variant in BuildQueries(normalized))
        {
            candidates = await SearchSuggestionsAsync(
                $"q={Uri.EscapeDataString(variant)}", boundedLimit, cancellationToken);
            if (candidates.Count > 0)
                break;
        }

        // Serbest metin bina seviyesine inemediyse yapılandırılmış aramayı deneriz.
        // Nominatim structured parametreleri q= ile birlikte 400 döndüğü için bu
        // ayrı bir çağrı olmak zorunda; en fazla bir ek istek atılır.
        if (wantedHouseNumber is not null
            && !string.IsNullOrWhiteSpace(parts.StreetSegment)
            && !candidates.Any(candidate => HasHouseNumber(candidate, wantedHouseNumber)))
        {
            try
            {
                // street= parametresi tek başına il/ilçe bağlamı taşımaz; adresin
                // geri kalan parçalarını (mahalle/ilçe/il) city= ile ekleriz,
                // yoksa aynı isimli sokak başka bir şehirde yanlışlıkla eşleşir.
                var locality = ExtractLocality(parts.WithoutHouseNumber, parts.StreetSegment);
                var structuredQuery = $"street={Uri.EscapeDataString($"{wantedHouseNumber} {parts.StreetSegment}")}";
                if (!string.IsNullOrWhiteSpace(locality))
                    structuredQuery += $"&city={Uri.EscapeDataString(locality)}";

                var structured = await SearchSuggestionsAsync(
                    structuredQuery,
                    boundedLimit,
                    cancellationToken);
                candidates = [.. structured, .. candidates];
            }
            catch (HttpRequestException)
            {
                // Yapılandırılmış aramayı desteklemeyen bir Nominatim sürümünde
                // öneriler hata vermek yerine serbest metin sonucunda kalsın.
            }
        }

        var suggestions = new List<GeocodingSuggestion>(boundedLimit);
        var seenAddresses = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        // OrderByDescending kararlı olduğu için Nominatim'in kendi önem sıralaması
        // kova içinde korunur; kullanıcı sayı yazmadığında sıra hiç değişmez.
        foreach (var candidate in candidates.OrderByDescending(c => Rank(c, wantedHouseNumber)))
        {
            var address = candidate.DisplayName?.Trim();
            if (string.IsNullOrWhiteSpace(address) || !seenAddresses.Add(address))
                continue;
            if (!TryParseCoordinates(candidate, out var longitude, out var latitude))
                continue;

            suggestions.Add(new GeocodingSuggestion(
                address,
                [longitude, latitude],
                candidate.Address?.HouseNumber,
                candidate.Address?.Street,
                candidate.Address?.Mahalle,
                candidate.Address?.Ilce,
                candidate.Address?.Il));
            if (suggestions.Count == boundedLimit)
                break;
        }

        return suggestions;
    }

    public async Task<string?> ReverseGeocodeDistrictAsync(double[] location, CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(options.BaseUrl) || location is not { Length: 2 })
            return null;

        try
        {
            var queryString = "reverse?format=jsonv2&addressdetails=1"
                + $"&lon={location[0].ToString(System.Globalization.CultureInfo.InvariantCulture)}"
                + $"&lat={location[1].ToString(System.Globalization.CultureInfo.InvariantCulture)}";
            var url = new Uri(new Uri(options.BaseUrl.TrimEnd('/') + "/"), queryString);
            using var response = await client.GetAsync(url, cancellationToken);
            if (!response.IsSuccessStatusCode)
                return null;

            var candidate = await response.Content.ReadFromJsonAsync<NominatimCandidate>(
                cancellationToken: cancellationToken);
            // Mahalle (Yaşamkent, Dikmen…) ilçeden (Çankaya) çok daha ayırt edici;
            // aynı ilçede duran onlarca araç aksi hâlde birebir aynı etikete düşüyor.
            return candidate?.Address?.Mahalle ?? candidate?.Address?.Ilce;
        }
        catch (Exception exception) when (exception is HttpRequestException or TaskCanceledException or JsonException)
        {
            // Servis isimlendirme önerisi kritik değil; reverse geocoding
            // başarısız olursa sessizce null döner, optimizasyon akışını bozmaz.
            return null;
        }
    }

    private async Task<List<NominatimCandidate>> SearchSuggestionsAsync(
        string queryFragment,
        int boundedLimit,
        CancellationToken cancellationToken)
    {
        var queryString = $"search?format=jsonv2&addressdetails=1&dedupe=1&limit={boundedLimit}"
            + $"&countrycodes={Uri.EscapeDataString(options.CountryCodes)}"
            + $"&{queryFragment}";
        var url = new Uri(new Uri(options.BaseUrl.TrimEnd('/') + "/"), queryString);
        using var response = await client.GetAsync(url, cancellationToken);
        response.EnsureSuccessStatusCode();
        return await response.Content.ReadFromJsonAsync<List<NominatimCandidate>>(
            cancellationToken: cancellationToken) ?? [];
    }

    /// <summary>
    /// Tam bina eşleşmesi &gt; cadde seviyesi &gt; başka bir bina numarası. Kullanıcı
    /// 49 yazmışken 47'yi göstermek yanıltıcı; cadde ise dürüstçe daha az kesin.
    /// </summary>
    private static int Rank(NominatimCandidate candidate, string? wantedHouseNumber)
    {
        if (wantedHouseNumber is null)
            return 0;

        var actual = NormalizeHouseNumber(candidate.Address?.HouseNumber);
        if (actual is null)
            return 2;
        return actual == wantedHouseNumber ? 3 : 1;
    }

    /// <summary>
    /// "Bayrak Sokak No:55, Keçiören, Ankara" içinden sokak parçası hariç kalan
    /// "Keçiören, Ankara" bölümünü döndürür; yapılandırılmış aramada city= olarak
    /// kullanılır ki aynı isimli sokak başka bir ilde yanlışlıkla eşleşmesin.
    /// </summary>
    private static string ExtractLocality(string withoutHouseNumber, string streetSegment)
    {
        var remaining = withoutHouseNumber
            .Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
            .Where(segment => !string.Equals(segment, streetSegment, StringComparison.OrdinalIgnoreCase))
            .ToList();
        return string.Join(", ", remaining);
    }

    private static bool HasHouseNumber(NominatimCandidate candidate, string wantedHouseNumber) =>
        NormalizeHouseNumber(candidate.Address?.HouseNumber) == wantedHouseNumber;

    /// <summary>"49/A" ile "49A" aynı binadır.</summary>
    private static string? NormalizeHouseNumber(string? value)
    {
        if (string.IsNullOrWhiteSpace(value))
            return null;
        var normalized = value
            .Replace("/", string.Empty, StringComparison.Ordinal)
            .Replace("-", string.Empty, StringComparison.Ordinal)
            .Replace(" ", string.Empty, StringComparison.Ordinal);
        return normalized.Length == 0 ? null : normalized.ToUpperInvariant();
    }

    private static IEnumerable<string> BuildQueries(string address)
    {
        // Ham adres yerine bina no'su sadeleştirilmiş hâliyle başlıyoruz: "No:" eki
        // Nominatim için eşleşmeyen bir kelime tokenı ve yalnızca skoru düşürüyor,
        // dolayısıyla ham hâli denemek bir tur kaybettirir. Bina no yoksa parser
        // metni aynen döndürür ve sorgu listesi bugünküyle birebir aynı kalır.
        var parts = TurkishAddressParser.Parse(address);
        var withoutBuildingNumber = parts.HouseNumber is null
            ? RemoveBuildingNumber(address)
            : parts.WithoutHouseNumber;
        var standardized = StandardizeAddress(withoutBuildingNumber);
        // RemovePremiseAfterStreetName yalnızca sokak adının bulunduğu virgülle
        // ayrılmış parçadaki fazlalığı (ör. "Kat:3") atmak için var; adres hiç
        // virgülsüzse (Türkçe yazımda çok yaygın) tüm metin tek bir parça sayılır
        // ve bu, sokaktan sonraki ilçe/il bilgisini de silip adresi başka
        // şehirdeki aynı isimli bir sokakla yanlış eşleştirebilir.
        var streetOnly = standardized.Contains(',')
            ? RemovePremiseAfterStreetName(standardized)
            : standardized;
        var streetFirst = PutStreetFirst(streetOnly);

        return new[] { parts.FreeText, withoutBuildingNumber, standardized, streetOnly, streetFirst }
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
            if (TryParseCoordinates(candidate, out var longitude, out var latitude))
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

    private static bool TryParseCoordinates(
        NominatimCandidate candidate,
        out double longitude,
        out double latitude)
    {
        var hasLongitude = double.TryParse(
                candidate.Lon,
                System.Globalization.NumberStyles.Float,
                System.Globalization.CultureInfo.InvariantCulture,
                out longitude);
        var hasLatitude = double.TryParse(
                candidate.Lat,
                System.Globalization.NumberStyles.Float,
                System.Globalization.CultureInfo.InvariantCulture,
                out latitude);
        return hasLongitude
            && hasLatitude
            && double.IsFinite(longitude)
            && double.IsFinite(latitude)
            && longitude is >= -180 and <= 180
            && latitude is >= -90 and <= 90;
    }

    private sealed record NominatimCandidate(
        [property: JsonPropertyName("lon")] string Lon,
        [property: JsonPropertyName("lat")] string Lat,
        [property: JsonPropertyName("display_name")] string? DisplayName,
        [property: JsonPropertyName("address")] NominatimAddress? Address = null);

    /// <summary>
    /// <c>addressdetails=1</c> cevabındaki <c>address</c> nesnesi. Alan adları yerel
    /// Nominatim'den (Ankara PBF, IMPORT_STYLE=address) gelen gerçek cevaplara göre
    /// seçildi; Türkçe kayıtlarda mahalle <c>suburb</c>'te, ilçe <c>town</c>'da,
    /// il <c>state</c>'te duruyor — <c>quarter</c> ise mahallenin altındaki bir
    /// semt oluyor ("Yenikent"), o yüzden mahalle için son çare.
    /// </summary>
    private sealed record NominatimAddress(
        [property: JsonPropertyName("house_number")] string? HouseNumber = null,
        [property: JsonPropertyName("road")] string? Road = null,
        [property: JsonPropertyName("pedestrian")] string? Pedestrian = null,
        [property: JsonPropertyName("footway")] string? Footway = null,
        [property: JsonPropertyName("residential")] string? Residential = null,
        [property: JsonPropertyName("suburb")] string? Suburb = null,
        [property: JsonPropertyName("city_district")] string? CityDistrict = null,
        [property: JsonPropertyName("quarter")] string? Quarter = null,
        [property: JsonPropertyName("neighbourhood")] string? Neighbourhood = null,
        [property: JsonPropertyName("town")] string? Town = null,
        [property: JsonPropertyName("municipality")] string? Municipality = null,
        [property: JsonPropertyName("county")] string? County = null,
        [property: JsonPropertyName("district")] string? District = null,
        [property: JsonPropertyName("state")] string? State = null,
        [property: JsonPropertyName("province")] string? Province = null,
        [property: JsonPropertyName("city")] string? City = null)
    {
        public string? Street => Coalesce(Road, Pedestrian, Footway, Residential);
        public string? Mahalle => Coalesce(Suburb, CityDistrict, Quarter, Neighbourhood);
        public string? Ilce => Coalesce(Town, Municipality, County, District);
        public string? Il => Coalesce(State, Province, City);

        private static string? Coalesce(params string?[] values) =>
            values.FirstOrDefault(value => !string.IsNullOrWhiteSpace(value));
    }
}

public static class GeocodingLocationResolver
{
    public static async Task<GeocodingResult?> ResolveAsync(
        string address,
        double? longitude,
        double? latitude,
        IGeocodingService geocoding,
        CancellationToken cancellationToken)
    {
        if (longitude.HasValue != latitude.HasValue)
            throw new ArgumentException("Boylam ve enlem birlikte verilmelidir.");

        if (longitude.HasValue && latitude.HasValue)
        {
            if (!double.IsFinite(longitude.Value)
                || !double.IsFinite(latitude.Value)
                || longitude.Value is < -180 or > 180
                || latitude.Value is < -90 or > 90)
                throw new ArgumentException("Geçerli bir boylam ve enlem verilmelidir.");

            return new GeocodingResult(longitude.Value, latitude.Value, address);
        }

        return await geocoding.GeocodeAsync(address, cancellationToken);
    }
}
