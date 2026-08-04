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

    private sealed class StubHandler(string responseBody) : HttpMessageHandler
    {
        public int CallCount { get; private set; }
        public Uri? LastRequestUri { get; private set; }

        protected override Task<HttpResponseMessage> SendAsync(
            HttpRequestMessage request,
            CancellationToken cancellationToken)
        {
            CallCount++;
            LastRequestUri = request.RequestUri;
            return Task.FromResult(new HttpResponseMessage(HttpStatusCode.OK)
            {
                Content = new StringContent(responseBody, Encoding.UTF8, "application/json"),
            });
        }
    }
}
