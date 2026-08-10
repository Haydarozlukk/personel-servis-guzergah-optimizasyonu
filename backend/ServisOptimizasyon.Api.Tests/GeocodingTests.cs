using System.Net;
using System.Text;
using Xunit;

public class GeocodingTests
{
    [Fact]
    public async Task NominatimResultIsConvertedToLongitudeLatitudeOrder()
    {
        var handler = new StubHandler(
            """[{"lon":"32.8597","lat":"39.9334","display_name":"Çankaya, Ankara"}]""");
        var client = new HttpClient(handler) { BaseAddress = new Uri("http://geocoding.local/") };
        var service = new NominatimGeocodingService(
            client,
            new GeocodingOptions { BaseUrl = "http://geocoding.local" });

        var result = await service.GeocodeAsync("  Çankaya,   Ankara  ", CancellationToken.None);

        Assert.NotNull(result);
        Assert.Equal(32.8597, result.Longitude, 4);
        Assert.Equal(39.9334, result.Latitude, 4);
        Assert.Contains("countrycodes=tr", handler.LastRequestUri!.Query);
    }

    [Fact]
    public async Task SuccessfulAddressIsReadFromCache()
    {
        var handler = new StubHandler(
            """[{"lon":"32.8597","lat":"39.9334","display_name":"Ankara"}]""");
        var client = new HttpClient(handler) { BaseAddress = new Uri("http://geocoding.local/") };
        var service = new NominatimGeocodingService(
            client,
            new GeocodingOptions { BaseUrl = "http://geocoding.local" });

        await service.GeocodeAsync("Ankara", CancellationToken.None);
        await service.GeocodeAsync(" ankara ", CancellationToken.None);

        Assert.Equal(1, handler.CallCount);
    }

    [Fact]
    public async Task MissingConfigurationDoesNotFallBackToPublicService()
    {
        var service = new NominatimGeocodingService(
            new HttpClient(new StubHandler("[]")),
            new GeocodingOptions());

        var exception = await Assert.ThrowsAsync<InvalidOperationException>(() =>
            service.GeocodeAsync("Ankara", CancellationToken.None));

        Assert.Contains("Geocoding:BaseUrl", exception.Message);
    }

    [Fact]
    public async Task BuildingNumberFallsBackToStreetWhenExactAddressIsMissing()
    {
        var handler = new StubHandler(
            "[]",
            """[{"lon":"32.6831","lat":"39.8642","display_name":"3053. Cadde, Yaşamkent, Ankara"}]""");
        var client = new HttpClient(handler) { BaseAddress = new Uri("http://geocoding.local/") };
        var service = new NominatimGeocodingService(
            client,
            new GeocodingOptions { BaseUrl = "http://geocoding.local" });

        var result = await service.GeocodeAsync(
            "3053. Cadde No: 49, Yaşamkent, Ankara",
            CancellationToken.None);

        Assert.NotNull(result);
        Assert.Equal(2, handler.CallCount);
        // İlk deneme artık ham adres değil, "No:" eki sadeleştirilmiş hâli — Nominatim
        // bu biçimde bina seviyesine inebiliyor, "No:" ile inemiyor.
        Assert.Contains("3053.%20Cadde%2049", handler.RequestUris[0].Query);
        Assert.DoesNotContain("No%3A", handler.RequestUris[0].Query);
        Assert.DoesNotContain("No%3A%2049", handler.RequestUris[1].Query);
        Assert.Contains("3053.%20Cadde", handler.RequestUris[1].Query);
    }

    [Fact]
    public async Task EnglishAddressNotationFallsBackToStreetFirstTurkishQuery()
    {
        var handler = new StubHandler(
            "[]",
            "[]",
            "[]",
            """[{"lon":"32.7629355","lat":"39.8989374","display_name":"Bilkent Bulvarı, Ankara"}]""");
        var client = new HttpClient(handler) { BaseAddress = new Uri("http://geocoding.local/") };
        var service = new NominatimGeocodingService(
            client,
            new GeocodingOptions { BaseUrl = "http://geocoding.local" });

        var result = await service.GeocodeAsync(
            "Üniversiteler, Bilkent Blv. Bilkent Plaza B1 Block, 06800 Çankaya/Ankara",
            CancellationToken.None);

        Assert.NotNull(result);
        Assert.Equal(32.7629355, result.Longitude, 7);
        Assert.Equal(39.8989374, result.Latitude, 7);
        Assert.Contains("Bilkent%20Bulvar%C4%B1%2C%20%C3%9Cniversiteler", handler.LastRequestUri!.Query);
        Assert.DoesNotContain("Plaza", handler.LastRequestUri.Query);
        Assert.DoesNotContain("06800", handler.LastRequestUri.Query);
    }

    [Fact]
    public async Task ConfiguredPublicServiceIsQueriedWithAnkaraBoundaryFirst()
    {
        var handler = new StubHandler(
            """[{"lon":"32.7545006","lat":"39.8842203","display_name":"TOKİ, Bilkent, Ankara"}]""");
        var client = new HttpClient(handler) { BaseAddress = new Uri("http://geocoding.local/") };
        var service = new NominatimGeocodingService(
            client,
            new GeocodingOptions
            {
                BaseUrl = "http://geocoding.local",
                PublicBaseUrl = "https://nominatim.openstreetmap.org",
            });

        var result = await service.GeocodeAsync("TOKİ Bilkent Ankara", CancellationToken.None);

        Assert.NotNull(result);
        Assert.Equal("nominatim.openstreetmap.org", handler.LastRequestUri!.Host);
        Assert.Contains("bounded=1", handler.LastRequestUri.Query);
        Assert.Contains("viewbox=", handler.LastRequestUri.Query);
        Assert.Equal(1, handler.CallCount);
    }

    [Fact]
    public async Task WrongStreetCandidateIsSkippedInFavorOfPlausibleCandidate()
    {
        var handler = new StubHandler(
            """
            [
              {"lon":"32.8100","lat":"39.9800","display_name":"1743. Sokak, Beytepe, Ankara"},
              {"lon":"32.7200","lat":"39.8900","display_name":"1816. Sokak, Beytepe, Ankara"}
            ]
            """);
        var client = new HttpClient(handler) { BaseAddress = new Uri("http://geocoding.local/") };
        var service = new NominatimGeocodingService(
            client,
            new GeocodingOptions { BaseUrl = "http://geocoding.local" });

        var result = await service.GeocodeAsync(
            "Beytepe Mahallesi 1816. Sokak Ankara",
            CancellationToken.None);

        Assert.NotNull(result);
        Assert.Equal(32.7200, result.Longitude, 4);
        Assert.Contains("1816", result.DisplayName);
        Assert.Contains("limit=5", handler.LastRequestUri!.Query);
    }

    [Fact]
    public async Task SuggestionsAreNormalizedLimitedDeduplicatedAndValidated()
    {
        var handler = new StubHandler(
            """
            [
              {"lon":"32.8100","lat":"39.9800","display_name":"Koza 1 Caddesi, Çankaya, Ankara"},
              {"lon":"32.8101","lat":"39.9801","display_name":"koza 1 caddesi, çankaya, ankara"},
              {"lon":"not-a-number","lat":"39.9800","display_name":"Geçersiz koordinat"},
              {"lon":"32.8200","lat":"39.9900","display_name":"Koza Sokak, Ankara"}
            ]
            """);
        var client = new HttpClient(handler) { BaseAddress = new Uri("http://geocoding.local/") };
        var service = new NominatimGeocodingService(
            client,
            new GeocodingOptions { BaseUrl = "http://geocoding.local" });

        var result = await service.SuggestAsync("  koza   1  ", 99, CancellationToken.None);

        Assert.Equal(2, result.Count);
        Assert.Equal([32.8100, 39.9800], result[0].Location);
        Assert.Equal("Koza Sokak, Ankara", result[1].Address);
        Assert.Contains("format=jsonv2", handler.LastRequestUri!.Query);
        Assert.Contains("addressdetails=1", handler.LastRequestUri.Query);
        Assert.Contains("dedupe=1", handler.LastRequestUri.Query);
        Assert.Contains("limit=5", handler.LastRequestUri.Query);
        Assert.Contains("q=koza%201", handler.LastRequestUri.Query);
    }

    [Fact]
    public async Task SuggestionsShorterThanThreeCharactersDoNotCallNominatim()
    {
        var handler = new StubHandler("[]");
        var service = new NominatimGeocodingService(
            new HttpClient(handler),
            new GeocodingOptions { BaseUrl = "http://geocoding.local" });

        var result = await service.SuggestAsync("ab", 5, CancellationToken.None);

        Assert.Empty(result);
        Assert.Equal(0, handler.CallCount);
    }

    // Aşağıdaki address gövdeleri yerel Nominatim'den (Ankara PBF) dönen gerçek
    // cevaplardan alındı: mahalle "suburb", ilçe "town", il "state" alanında.
    private const string HouseCandidate = """
        {"lon":"32.6665836","lat":"39.8695189",
         "display_name":"49, 3053. Cadde, Yenikent, Yaşamkent Mahallesi, Çankaya, Ankara, 06810, Türkiye",
         "address":{"house_number":"49","road":"3053. Cadde","quarter":"Yenikent",
                    "suburb":"Yaşamkent Mahallesi","town":"Çankaya","state":"Ankara","postcode":"06810"}}
        """;

    private const string StreetCandidate = """
        {"lon":"32.6831","lat":"39.8642",
         "display_name":"3053. Cadde, Yaşamkent Mahallesi, Çankaya, Ankara, Türkiye",
         "address":{"road":"3053. Cadde","suburb":"Yaşamkent Mahallesi","town":"Çankaya","state":"Ankara"}}
        """;

    [Fact]
    public async Task SuggestionsExposeStructuredAddressDetails()
    {
        var handler = new StubHandler($"[{HouseCandidate}]");
        var service = NominatimService(handler);

        var result = await service.SuggestAsync("3053. Cadde No: 49", 5, CancellationToken.None);

        var suggestion = Assert.Single(result);
        Assert.Equal("49", suggestion.HouseNumber);
        Assert.Equal("3053. Cadde", suggestion.Street);
        Assert.Equal("Yaşamkent Mahallesi", suggestion.Neighbourhood);
        Assert.Equal("Çankaya", suggestion.District);
        Assert.Equal("Ankara", suggestion.City);
    }

    [Fact]
    public async Task SuggestionsFallBackToAlternativeAdministrativeFieldNames()
    {
        var handler = new StubHandler("""
            [{"lon":"32.75","lat":"39.89","display_name":"Erdoğan Yavuzlar Bulvarı, Üniversiteler, Çankaya",
              "address":{"pedestrian":"Erdoğan Yavuzlar Bulvarı","city_district":"Üniversiteler Mahallesi",
                         "county":"Çankaya","province":"Ankara"}}]
            """);
        var service = NominatimService(handler);

        var result = await service.SuggestAsync("Erdoğan Yavuzlar", 5, CancellationToken.None);

        var suggestion = Assert.Single(result);
        Assert.Equal("Erdoğan Yavuzlar Bulvarı", suggestion.Street);
        Assert.Equal("Üniversiteler Mahallesi", suggestion.Neighbourhood);
        Assert.Equal("Çankaya", suggestion.District);
        Assert.Equal("Ankara", suggestion.City);
    }

    [Fact]
    public async Task StructuredSecondPassRunsWhenFreeTextMissesTheHouseNumber()
    {
        var handler = new StubHandler($"[{StreetCandidate}]", $"[{HouseCandidate}]");
        var service = NominatimService(handler);

        var result = await service.SuggestAsync("3053. Cadde No: 49", 5, CancellationToken.None);

        Assert.Equal(2, handler.CallCount);
        Assert.Contains("q=", handler.RequestUris[0].Query);
        // Yapılandırılmış arama q= ile birleştirilemez (Nominatim 400 döner).
        Assert.Contains("street=49%203053.%20Cadde", handler.RequestUris[1].Query);
        Assert.DoesNotContain("q=", handler.RequestUris[1].Query);
        Assert.Equal("49", result[0].HouseNumber);
    }

    [Fact]
    public async Task StructuredSecondPassIsSkippedWhenFreeTextAlreadyFoundTheHouseNumber()
    {
        var handler = new StubHandler($"[{HouseCandidate}]");
        var service = NominatimService(handler);

        await service.SuggestAsync("3053. Cadde No: 49", 5, CancellationToken.None);

        Assert.Equal(1, handler.CallCount);
    }

    [Fact]
    public async Task StructuredSecondPassIsSkippedWhenNoHouseNumberWasTyped()
    {
        var handler = new StubHandler($"[{StreetCandidate}]");
        var service = NominatimService(handler);

        await service.SuggestAsync("3053. Cadde", 5, CancellationToken.None);

        Assert.Equal(1, handler.CallCount);
    }

    [Fact]
    public async Task StructuredSecondPassFailureFallsBackToFreeTextSuggestions()
    {
        var handler = new FailingAfterFirstCallHandler($"[{StreetCandidate}]");
        var service = NominatimService(handler);

        var result = await service.SuggestAsync("3053. Cadde No: 49", 5, CancellationToken.None);

        var suggestion = Assert.Single(result);
        Assert.Null(suggestion.HouseNumber);
        Assert.Equal("3053. Cadde", suggestion.Street);
    }

    [Fact]
    public async Task ExactHouseNumberIsRankedAboveStreetAndOtherBuildings()
    {
        var otherHouse = HouseCandidate
            .Replace("\"house_number\":\"49\"", "\"house_number\":\"47\"")
            .Replace("\"display_name\":\"49,", "\"display_name\":\"47,");
        var handler = new StubHandler($"[{StreetCandidate},{otherHouse},{HouseCandidate}]");
        var service = NominatimService(handler);

        var result = await service.SuggestAsync("3053. Cadde No: 49", 5, CancellationToken.None);

        Assert.Equal(3, result.Count);
        Assert.Equal("49", result[0].HouseNumber);   // tam eşleşme
        Assert.Null(result[1].HouseNumber);          // cadde seviyesi
        Assert.Equal("47", result[2].HouseNumber);   // yanlış bina en sonda
    }

    [Fact]
    public async Task SuggestionOrderIsUntouchedWhenNoHouseNumberWasTyped()
    {
        var handler = new StubHandler("""
            [{"lon":"32.82","lat":"39.99","display_name":"Koza Sokak, Ankara"},
             {"lon":"32.81","lat":"39.98","display_name":"Koza 1 Caddesi, Çankaya, Ankara"}]
            """);
        var service = NominatimService(handler);

        var result = await service.SuggestAsync("koza", 5, CancellationToken.None);

        Assert.Equal("Koza Sokak, Ankara", result[0].Address);
        Assert.Equal("Koza 1 Caddesi, Çankaya, Ankara", result[1].Address);
    }

    [Fact]
    public async Task ApartmentNumberIsNotSentAsTheBuildingNumber()
    {
        var handler = new StubHandler("[]");
        var service = NominatimService(handler);

        await service.SuggestAsync("İnönü Caddesi No:12 D:5", 5, CancellationToken.None);

        Assert.Contains("12", handler.RequestUris[0].Query);
        Assert.DoesNotContain("D%3A5", handler.RequestUris[0].Query);
        Assert.Contains("street=12%20", handler.RequestUris[1].Query);
    }

    private static NominatimGeocodingService NominatimService(HttpMessageHandler handler) =>
        new(
            new HttpClient(handler) { BaseAddress = new Uri("http://geocoding.local/") },
            new GeocodingOptions { BaseUrl = "http://geocoding.local" });

    [Fact]
    public async Task SuppliedCoordinatesSkipAddressGeocoding()
    {
        var geocoding = new CountingGeocodingService();

        var result = await GeocodingLocationResolver.ResolveAsync(
            "Koza 1 Caddesi, Ankara",
            32.81,
            39.98,
            geocoding,
            CancellationToken.None);

        Assert.NotNull(result);
        Assert.Equal(32.81, result.Longitude);
        Assert.Equal(39.98, result.Latitude);
        Assert.Equal(0, geocoding.GeocodeCallCount);
    }

    [Theory]
    [InlineData(32.81, null)]
    [InlineData(null, 39.98)]
    [InlineData(181.0, 39.98)]
    public async Task InvalidSuppliedCoordinatesAreRejected(double? longitude, double? latitude)
    {
        var geocoding = new CountingGeocodingService();

        await Assert.ThrowsAsync<ArgumentException>(() =>
            GeocodingLocationResolver.ResolveAsync(
                "Koza 1 Caddesi, Ankara",
                longitude,
                latitude,
                geocoding,
                CancellationToken.None));

        Assert.Equal(0, geocoding.GeocodeCallCount);
    }

    private sealed class CountingGeocodingService : IGeocodingService
    {
        public int GeocodeCallCount { get; private set; }

        public Task<GeocodingResult?> GeocodeAsync(string address, CancellationToken cancellationToken)
        {
            GeocodeCallCount++;
            return Task.FromResult<GeocodingResult?>(new(32.8, 39.9, address));
        }

        public Task<IReadOnlyList<GeocodingSuggestion>> SuggestAsync(
            string query,
            int limit,
            CancellationToken cancellationToken) =>
            Task.FromResult<IReadOnlyList<GeocodingSuggestion>>([]);
    }

    /// <summary>
    /// İlk çağrıyı yanıtlar, sonrakileri ağ hatasıyla düşürür — yapılandırılmış
    /// ikinci pass'i desteklemeyen bir Nominatim'i taklit eder.
    /// </summary>
    private sealed class FailingAfterFirstCallHandler(string firstResponseBody) : HttpMessageHandler
    {
        private int _callCount;

        protected override Task<HttpResponseMessage> SendAsync(
            HttpRequestMessage request,
            CancellationToken cancellationToken)
        {
            if (Interlocked.Increment(ref _callCount) > 1)
                throw new HttpRequestException("structured search not supported");

            return Task.FromResult(new HttpResponseMessage(HttpStatusCode.OK)
            {
                Content = new StringContent(firstResponseBody, Encoding.UTF8, "application/json"),
            });
        }
    }

    private sealed class StubHandler(params string[] responseBodies) : HttpMessageHandler
    {
        public int CallCount { get; private set; }
        public Uri? LastRequestUri { get; private set; }
        public List<Uri> RequestUris { get; } = [];

        protected override Task<HttpResponseMessage> SendAsync(
            HttpRequestMessage request,
            CancellationToken cancellationToken)
        {
            CallCount++;
            LastRequestUri = request.RequestUri;
            RequestUris.Add(request.RequestUri!);
            var responseBody = responseBodies[Math.Min(CallCount - 1, responseBodies.Length - 1)];
            return Task.FromResult(new HttpResponseMessage(HttpStatusCode.OK)
            {
                Content = new StringContent(responseBody, Encoding.UTF8, "application/json"),
            });
        }
    }
}
