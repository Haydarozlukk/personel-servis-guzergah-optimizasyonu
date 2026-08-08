using System.Text;
using Xunit;

public class RestrictedAreaCheckerTests : IDisposable
{
    // 32.0–32.1 boylam, 39.0–39.1 enlem arasında kare bir kapalı alan.
    private const string SquareAreaGeoJson = """
        {
          "type": "FeatureCollection",
          "features": [
            {
              "type": "Feature",
              "properties": { "id": "test-alan", "name": "Test Kapalı Alan" },
              "geometry": {
                "type": "Polygon",
                "coordinates": [
                  [[32.0, 39.0], [32.1, 39.0], [32.1, 39.1], [32.0, 39.1], [32.0, 39.0]]
                ]
              }
            }
          ]
        }
        """;

    private readonly string _geoJsonPath = Path.Combine(Path.GetTempPath(), $"{Guid.NewGuid():N}.geojson");

    public RestrictedAreaCheckerTests() => File.WriteAllText(_geoJsonPath, SquareAreaGeoJson);

    public void Dispose() => File.Delete(_geoJsonPath);

    private RestrictedAreaChecker Checker() => RestrictedAreaChecker.Load(_geoJsonPath);

    [Fact]
    public void RouteInsideAreaIsReported()
    {
        var geometry = Encode((39.02, 32.02), (39.05, 32.05), (39.08, 32.08));

        Assert.Equal(["Test Kapalı Alan"], Checker().FindCrossings(geometry));
    }

    [Fact]
    public void RouteOutsideAreaIsClean()
    {
        var geometry = Encode((39.90, 32.85), (39.92, 32.86), (39.94, 32.87));

        Assert.Empty(Checker().FindCrossings(geometry));
    }

    /// <summary>
    /// Seyrek geometride alanın iki yakasındaki ardışık noktalar tek başına
    /// nokta testinden geçer; kesişim bacak üzerinden yakalanmalıdır.
    /// </summary>
    [Fact]
    public void RouteCuttingStraightThroughIsReported()
    {
        var geometry = Encode((39.05, 31.90), (39.05, 32.20));

        Assert.Equal(["Test Kapalı Alan"], Checker().FindCrossings(geometry));
    }

    [Fact]
    public void RouteSkirtingTheBorderIsClean()
    {
        var geometry = Encode((38.99, 31.90), (38.99, 32.20));

        Assert.Empty(Checker().FindCrossings(geometry));
    }

    /// <summary>
    /// Kapalı alan sınırları çoğu yerde kamu yolunun üzerinden geçtiği için
    /// kenara teğet giden güzergâhlar uyarı üretmemelidir.
    /// </summary>
    [Fact]
    public void RouteGrazingTheEdgeIsClean()
    {
        // Sınırın 2 m içinden geçen, alan içinde ~30 m kalan bir güzergâh.
        var geometry = Encode((39.00002, 32.04980), (39.00002, 32.05010));

        Assert.Empty(Checker().FindCrossings(geometry));
    }

    [Fact]
    public void EmptyCheckerReportsNothing()
    {
        Assert.Empty(RestrictedAreaChecker.Empty.FindCrossings(Encode((39.05, 32.05))));
    }

    [Fact]
    public void MissingGeometryIsClean()
    {
        Assert.Empty(Checker().FindCrossings(null));
        Assert.Empty(Checker().FindCrossings(string.Empty));
    }

    private static string Encode(params (double Lat, double Lon)[] points)
    {
        var builder = new StringBuilder();
        var lastLatitude = 0;
        var lastLongitude = 0;

        foreach (var (latitude, longitude) in points)
        {
            var scaledLatitude = (int)Math.Round(latitude * 1e5);
            var scaledLongitude = (int)Math.Round(longitude * 1e5);
            AppendValue(builder, scaledLatitude - lastLatitude);
            AppendValue(builder, scaledLongitude - lastLongitude);
            lastLatitude = scaledLatitude;
            lastLongitude = scaledLongitude;
        }

        return builder.ToString();
    }

    private static void AppendValue(StringBuilder builder, int value)
    {
        var encoded = value < 0 ? ~(value << 1) : value << 1;
        while (encoded >= 0x20)
        {
            builder.Append((char)((0x20 | (encoded & 0x1f)) + 63));
            encoded >>= 5;
        }
        builder.Append((char)(encoded + 63));
    }
}
