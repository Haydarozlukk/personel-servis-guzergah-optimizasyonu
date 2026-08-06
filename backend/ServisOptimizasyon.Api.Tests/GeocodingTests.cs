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
