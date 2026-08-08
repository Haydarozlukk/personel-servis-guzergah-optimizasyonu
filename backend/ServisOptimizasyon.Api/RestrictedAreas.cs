using System.Text.Json;

public sealed class RestrictedAreasOptions
{
    public string FilePath { get; set; } = "/config/restricted-areas.geojson";
}

/// <summary>
/// Google/Yandex kodlamalı polyline çözücü. OSRM ve VROOM rota geometrilerini
/// bu biçimde döndürür.
/// </summary>
public static class PolylineCodec
{
    public static List<(double Lat, double Lon)> Decode(string encoded)
    {
        var points = new List<(double, double)>();
        var index = 0;
        var lat = 0;
        var lon = 0;
        while (index < encoded.Length)
        {
            lat += DecodeValue(encoded, ref index);
            lon += DecodeValue(encoded, ref index);
            points.Add((lat / 1e5, lon / 1e5));
        }
        return points;
    }

    private static int DecodeValue(string encoded, ref int index)
    {
        var result = 0;
        var shift = 0;
        int value;
        do
        {
            value = encoded[index++] - 63;
            result |= (value & 0x1f) << shift;
            shift += 5;
        }
        while (value >= 0x20);
        return (result & 1) != 0 ? ~(result >> 1) : result >> 1;
    }
}

/// <summary>
/// Halka kapalı bir alanın sınırı. Halkalar WGS84 <c>[lon, lat]</c> sırasında ve
/// kapalıdır; delikli poligonlarda ilk halka dış sınır, kalanlar deliktir.
/// </summary>
public sealed class RestrictedArea
{
    public RestrictedArea(string id, string name, IReadOnlyList<double[][]> rings)
    {
        Id = id;
        Name = name;
        Rings = rings;

        MinLon = rings.Min(ring => ring.Min(point => point[0]));
        MinLat = rings.Min(ring => ring.Min(point => point[1]));
        MaxLon = rings.Max(ring => ring.Max(point => point[0]));
        MaxLat = rings.Max(ring => ring.Max(point => point[1]));
    }

    public string Id { get; }
    public string Name { get; }
    public IReadOnlyList<double[][]> Rings { get; }
    public double MinLon { get; }
    public double MinLat { get; }
    public double MaxLon { get; }
    public double MaxLat { get; }

    public bool Contains(double lon, double lat)
    {
        if (lon < MinLon || lon > MaxLon || lat < MinLat || lat > MaxLat) return false;

        // Dış sınır ve delikler aynı even-odd sayımına girer: tek sayı içeride,
        // çift sayı dışarıda demektir.
        var inside = false;
        foreach (var ring in Rings)
        {
            for (var index = 0; index < ring.Length - 1; index++)
            {
                var (x1, y1) = (ring[index][0], ring[index][1]);
                var (x2, y2) = (ring[index + 1][0], ring[index + 1][1]);
                if (y1 > lat != y2 > lat && lon < x1 + ((lat - y1) * (x2 - x1) / (y2 - y1)))
                    inside = !inside;
            }
        }
        return inside;
    }

    /// <summary>
    /// Bacağın alan içinde kalan bölümünün uzunluğu (metre). Bacak sınırla
    /// kesiştiği noktalardan bölünüp yalnızca içeride kalan parçalar toplanır;
    /// böylece sınıra teğet geçen bir yol gerçek uzunluğu kadar, alanın içinden
    /// geçen bir yol da tam kat ettiği kadar sayılır.
    /// </summary>
    public double InsideLengthMeters(double lon1, double lat1, double lon2, double lat2)
    {
        if (Math.Max(lon1, lon2) < MinLon || Math.Min(lon1, lon2) > MaxLon) return 0;
        if (Math.Max(lat1, lat2) < MinLat || Math.Min(lat1, lat2) > MaxLat) return 0;

        var cuts = new List<double> { 0, 1 };
        foreach (var ring in Rings)
        {
            for (var index = 0; index < ring.Length - 1; index++)
            {
                var offset = IntersectionOffset(
                    lon1, lat1, lon2, lat2,
                    ring[index][0], ring[index][1],
                    ring[index + 1][0], ring[index + 1][1]);
                if (offset is not null) cuts.Add(offset.Value);
            }
        }

        cuts.Sort();
        var total = 0.0;
        for (var index = 0; index < cuts.Count - 1; index++)
        {
            var (from, to) = (cuts[index], cuts[index + 1]);
            if (to - from <= double.Epsilon) continue;

            var middle = (from + to) / 2;
            if (!Contains(lon1 + ((lon2 - lon1) * middle), lat1 + ((lat2 - lat1) * middle))) continue;

            total += (to - from) * DistanceMeters(lat1, lon1, lat2, lon2);
        }
        return total;
    }

    /// <summary>AB bacağı üzerinde CD ile kesiştiği konum (0..1); kesişmiyorsa null.</summary>
    private static double? IntersectionOffset(
        double ax, double ay, double bx, double by,
        double cx, double cy, double dx, double dy)
    {
        var rx = bx - ax;
        var ry = by - ay;
        var sx = dx - cx;
        var sy = dy - cy;
        var denominator = (rx * sy) - (ry * sx);
        if (denominator == 0) return null;

        var offset = (((cx - ax) * sy) - ((cy - ay) * sx)) / denominator;
        var other = (((cx - ax) * ry) - ((cy - ay) * rx)) / denominator;
        return offset is >= 0 and <= 1 && other is >= 0 and <= 1 ? offset : null;
    }

    internal static double DistanceMeters(double lat1, double lon1, double lat2, double lon2)
    {
        const double metersPerDegreeLatitude = 110540;
        const double metersPerDegreeLongitude = 111320;
        var averageLatitude = (lat1 + lat2) / 2 * Math.PI / 180;
        var deltaY = (lat2 - lat1) * metersPerDegreeLatitude;
        var deltaX = (lon2 - lon1) * metersPerDegreeLongitude * Math.Cos(averageLatitude);
        return Math.Sqrt((deltaX * deltaX) + (deltaY * deltaY));
    }
}

/// <summary>
/// Rota geometrilerinin halka kapalı alanlardan geçip geçmediğini denetler.
/// Asıl korumayı OSRM grafiği sağlar (bu alanların içindeki yollar
/// <c>access=no</c> ile işaretlenir); bu denetim harita verisi eskidiğinde veya
/// yeni bir alan henüz grafiğe işlenmediğinde durumu görünür kılan ikinci
/// katmandır.
/// </summary>
public sealed class RestrictedAreaChecker
{
    public static readonly RestrictedAreaChecker Empty = new([], "{\"type\":\"FeatureCollection\",\"features\":[]}");

    /// <summary>
    /// Bir rotanın alan içinde geçirmesi gereken en kısa mesafe. Kapalı alanların
    /// sınırı çoğu yerde kamu yolunun tam üzerinden geçtiği için, kenara teğet
    /// giden güzergâhlar bu eşiğin altında kalır ve uyarı üretmez.
    /// </summary>
    private const double MinimumCrossingMeters = 75;

    private readonly List<RestrictedArea> _areas;

    private RestrictedAreaChecker(List<RestrictedArea> areas, string geoJson)
    {
        _areas = areas;
        GeoJson = geoJson;
    }

    /// <summary>Arayüzün katman olarak çizdiği ham GeoJSON.</summary>
    public string GeoJson { get; }

    public IReadOnlyList<RestrictedArea> Areas => _areas;

    public static RestrictedAreaChecker Load(string filePath)
    {
        var geoJson = File.ReadAllText(filePath);
        using var document = JsonDocument.Parse(geoJson);

        var areas = new List<RestrictedArea>();
        foreach (var feature in document.RootElement.GetProperty("features").EnumerateArray())
        {
            var properties = feature.GetProperty("properties");
            var id = properties.GetProperty("id").GetString() ?? string.Empty;
            var name = properties.GetProperty("name").GetString() ?? id;
            var geometry = feature.GetProperty("geometry");
            var type = geometry.GetProperty("type").GetString();
            var coordinates = geometry.GetProperty("coordinates");

            var polygons = type switch
            {
                "Polygon" => new[] { coordinates },
                "MultiPolygon" => coordinates.EnumerateArray().ToArray(),
                _ => throw new InvalidOperationException($"{name}: desteklenmeyen geometri {type}."),
            };

            foreach (var polygon in polygons)
                areas.Add(new RestrictedArea(id, name, ReadRings(polygon)));
        }

        return new RestrictedAreaChecker(areas, geoJson);
    }

    /// <summary>
    /// Kodlanmış rota geometrisinin kestiği kapalı alanların adları; rota temizse
    /// boş liste döner.
    /// </summary>
    public IReadOnlyList<string> FindCrossings(string? encodedGeometry)
    {
        if (_areas.Count == 0 || string.IsNullOrEmpty(encodedGeometry)) return [];

        var points = PolylineCodec.Decode(encodedGeometry);
        if (points.Count == 0) return [];

        var crossed = new List<string>();
        foreach (var area in _areas)
        {
            if (crossed.Contains(area.Name)) continue;
            if (Crosses(area, points)) crossed.Add(area.Name);
        }
        return crossed;
    }

    private static bool Crosses(RestrictedArea area, List<(double Lat, double Lon)> points)
    {
        var insideMeters = 0.0;

        for (var index = 0; index < points.Count - 1; index++)
        {
            var (fromLat, fromLon) = points[index];
            var (toLat, toLon) = points[index + 1];

            insideMeters += area.InsideLengthMeters(fromLon, fromLat, toLon, toLat);
            if (insideMeters >= MinimumCrossingMeters) return true;
        }
        return false;
    }

    private static double[][][] ReadRings(JsonElement polygon) =>
        [.. polygon.EnumerateArray().Select(ring =>
            ring.EnumerateArray()
                .Select(point => new[] { point[0].GetDouble(), point[1].GetDouble() })
                .ToArray())];
}
