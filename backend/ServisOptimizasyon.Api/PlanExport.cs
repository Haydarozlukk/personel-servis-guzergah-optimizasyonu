using System.Globalization;
using System.IO.Compression;
using System.Text;
using System.Xml.Linq;
using ClosedXML.Excel;

public static class PlanExport
{
    public static byte[] BuildPackage(ScenarioResult plan)
    {
        using var output = new MemoryStream();
        using (var archive = new ZipArchive(output, ZipArchiveMode.Create, leaveOpen: true))
        {
            foreach (var route in plan.Routes)
            {
                var safeName = SafeFileName(route.VehicleId);
                WriteText(archive, $"guzergahlar/{safeName}.kml", BuildKml(plan, route));
                WriteText(archive, $"guzergahlar/{safeName}.gpx", BuildGpx(plan, route));
                WriteText(archive, $"guzergahlar/{safeName}-sirali-koordinatlar.txt", BuildOrderedCoordinates(plan, route));
            }
            var excel = archive.CreateEntry("servis-ve-yolcu-listeleri.xlsx", CompressionLevel.Optimal);
            using (var entryStream = excel.Open())
                entryStream.Write(BuildWorkbook(plan));
            WriteText(archive, "README.txt", """
                KML ve GPX dosyaları Google My Maps ve bu biçimleri destekleyen harita uygulamalarına aktarılabilir.
                Sirali-koordinatlar dosyası her servisin duraklarını en fazla 20 noktalık parçalara ayırır;
                bu noktalar Yandex Navigator veya başka navigasyon uygulamalarına sırayla girilebilir.
                """);
        }
        return output.ToArray();
    }

    private static byte[] BuildWorkbook(ScenarioResult plan)
    {
        using var workbook = new XLWorkbook();
        var vehicles = workbook.Worksheets.Add("servisler");
        string[] vehicleHeaders = ["servis", "plaka", "kapasite", "rezerv boş koltuk", "etkin kapasite", "atanan yolcu", "mesafe km", "süre dk"];
        for (var i = 0; i < vehicleHeaders.Length; i++) vehicles.Cell(1, i + 1).Value = vehicleHeaders[i];
        foreach (var item in plan.Vehicles.Select((vehicle, index) => (vehicle, index)))
        {
            var route = plan.Routes.FirstOrDefault(candidate => candidate.VehicleId == item.vehicle.Id);
            vehicles.Cell(item.index + 2, 1).Value = item.vehicle.Id;
            vehicles.Cell(item.index + 2, 2).Value = item.vehicle.Plate ?? "";
            vehicles.Cell(item.index + 2, 3).Value = item.vehicle.Capacity;
            vehicles.Cell(item.index + 2, 4).Value = item.vehicle.ReservedSeats;
            vehicles.Cell(item.index + 2, 5).Value = item.vehicle.EffectiveCapacity;
            vehicles.Cell(item.index + 2, 6).Value = route?.Load ?? 0;
            vehicles.Cell(item.index + 2, 7).Value = (route?.DistanceMeters ?? 0) / 1000d;
            vehicles.Cell(item.index + 2, 8).Value = (route?.DurationSeconds ?? 0) / 60d;
        }

        var stopById = plan.Stops.ToDictionary(stop => stop.Id, StringComparer.Ordinal);
        var vehicleByPerson = new Dictionary<string, string>(StringComparer.Ordinal);
        var stopByPerson = new Dictionary<string, string>(StringComparer.Ordinal);
        foreach (var route in plan.Routes)
        foreach (var stopId in route.StopIds)
        {
            if (!stopById.TryGetValue(stopId, out var stop)) continue;
            foreach (var personId in stop.AssignedPersonIds)
            {
                vehicleByPerson[personId] = route.VehicleId;
                stopByPerson[personId] = stopId;
            }
        }

        var persons = workbook.Worksheets.Add("yolcular");
        string[] personHeaders = ["sicil", "ad soyad", "servis", "durak", "boylam", "enlem", "durum"];
        for (var i = 0; i < personHeaders.Length; i++) persons.Cell(1, i + 1).Value = personHeaders[i];
        foreach (var item in plan.Persons.Select((person, index) => (person, index)))
        {
            persons.Cell(item.index + 2, 1).Value = item.person.Id;
            persons.Cell(item.index + 2, 2).Value = item.person.Name ?? "";
            persons.Cell(item.index + 2, 3).Value = vehicleByPerson.GetValueOrDefault(item.person.Id, "");
            persons.Cell(item.index + 2, 4).Value = stopByPerson.GetValueOrDefault(item.person.Id, "");
            persons.Cell(item.index + 2, 5).Value = item.person.Location[0];
            persons.Cell(item.index + 2, 6).Value = item.person.Location[1];
            persons.Cell(item.index + 2, 7).Value = vehicleByPerson.ContainsKey(item.person.Id) ? "atanmış" : "servis atanmamış";
        }

        var stops = workbook.Worksheets.Add("duraklar");
        string[] stopHeaders = ["durak", "servis", "sıra", "yolcu sayısı", "boylam", "enlem"];
        for (var i = 0; i < stopHeaders.Length; i++) stops.Cell(1, i + 1).Value = stopHeaders[i];
        var row = 2;
        foreach (var route in plan.Routes)
        for (var index = 0; index < route.StopIds.Count; index++)
        {
            if (!stopById.TryGetValue(route.StopIds[index], out var stop)) continue;
            stops.Cell(row, 1).Value = stop.Id;
            stops.Cell(row, 2).Value = route.VehicleId;
            stops.Cell(row, 3).Value = index + 1;
            stops.Cell(row, 4).Value = stop.AssignedPersonIds.Count;
            stops.Cell(row, 5).Value = stop.Location[0];
            stops.Cell(row, 6).Value = stop.Location[1];
            row++;
        }

        foreach (var sheet in workbook.Worksheets)
        {
            sheet.Row(1).Style.Font.Bold = true;
            sheet.SheetView.FreezeRows(1);
            sheet.Columns().AdjustToContents();
        }
        using var stream = new MemoryStream();
        workbook.SaveAs(stream);
        return stream.ToArray();
    }

    private static string BuildKml(ScenarioResult plan, RouteResult route)
    {
        XNamespace kml = "http://www.opengis.net/kml/2.2";
        var coordinates = string.Join(" ", RoutePoints(plan, route)
            .Select(point => $"{F(point.Lon)},{F(point.Lat)},0"));
        var document = new XElement(kml + "Document",
            new XElement(kml + "name", route.VehicleId),
            new XElement(kml + "Placemark",
                new XElement(kml + "name", $"{route.VehicleId} güzergâhı"),
                new XElement(kml + "LineString",
                    new XElement(kml + "tessellate", 1),
                    new XElement(kml + "coordinates", coordinates))));
        foreach (var stop in OrderedStops(plan, route))
            document.Add(new XElement(kml + "Placemark",
                new XElement(kml + "name", stop.Id),
                new XElement(kml + "Point", new XElement(kml + "coordinates", $"{F(stop.Location[0])},{F(stop.Location[1])},0"))));
        document.Add(new XElement(kml + "Placemark",
            new XElement(kml + "name", "Varış noktası"),
            new XElement(kml + "Point", new XElement(kml + "coordinates", $"{F(plan.Workplace[0])},{F(plan.Workplace[1])},0"))));
        return new XDocument(new XDeclaration("1.0", "utf-8", null), new XElement(kml + "kml", document)).ToString();
    }

    private static string BuildGpx(ScenarioResult plan, RouteResult route)
    {
        XNamespace gpx = "http://www.topografix.com/GPX/1/1";
        var root = new XElement(gpx + "gpx", new XAttribute("version", "1.1"), new XAttribute("creator", "Servis Optimizasyon"));
        foreach (var stop in OrderedStops(plan, route))
            root.Add(new XElement(gpx + "wpt", new XAttribute("lat", F(stop.Location[1])), new XAttribute("lon", F(stop.Location[0])), new XElement(gpx + "name", stop.Id)));
        var segment = new XElement(gpx + "trkseg", RoutePoints(plan, route)
            .Select(point => new XElement(gpx + "trkpt", new XAttribute("lat", F(point.Lat)), new XAttribute("lon", F(point.Lon)))));
        root.Add(new XElement(gpx + "trk", new XElement(gpx + "name", route.VehicleId), segment));
        return new XDocument(new XDeclaration("1.0", "utf-8", null), root).ToString();
    }

    private static string BuildOrderedCoordinates(ScenarioResult plan, RouteResult route)
    {
        var points = OrderedStops(plan, route).Select(stop => stop.Location)
            .Append(plan.Workplace).ToList();
        var builder = new StringBuilder();
        var part = 1;
        for (var index = 0; index < points.Count; index += 19)
        {
            var chunk = points.Skip(index).Take(20).ToList();
            builder.AppendLine($"Parça {part++}");
            foreach (var point in chunk) builder.AppendLine($"{F(point[1])},{F(point[0])}");
            builder.AppendLine();
        }
        return builder.ToString();
    }

    private static IEnumerable<StopResult> OrderedStops(ScenarioResult plan, RouteResult route)
    {
        var stops = plan.Stops.ToDictionary(stop => stop.Id, StringComparer.Ordinal);
        return route.StopIds.Where(stops.ContainsKey).Select(id => stops[id]);
    }

    private static List<(double Lat, double Lon)> RoutePoints(ScenarioResult plan, RouteResult route)
    {
        var decoded = PolylineCodec.Decode(route.Geometry);
        return decoded.Count > 0
            ? decoded
            : OrderedStops(plan, route)
                .Select(stop => (Lat: stop.Location[1], Lon: stop.Location[0]))
                .Append((plan.Workplace[1], plan.Workplace[0]))
                .ToList();
    }

    private static string F(double value) => value.ToString("0.######", CultureInfo.InvariantCulture);
    private static string SafeFileName(string value) => string.Concat(value.Select(character => Path.GetInvalidFileNameChars().Contains(character) ? '_' : character));
    private static void WriteText(ZipArchive archive, string path, string content)
    {
        var entry = archive.CreateEntry(path, CompressionLevel.Optimal);
        using var writer = new StreamWriter(entry.Open(), new UTF8Encoding(false));
        writer.Write(content);
    }
}
