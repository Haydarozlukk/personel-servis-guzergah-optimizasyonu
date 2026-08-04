using System.Globalization;
using ClosedXML.Excel;

public sealed record ExcelImportForm(
    string Name,
    TimeOnly ArrivalDeadline,
    double[] Workplace,
    int? VehicleCount,
    int? VehicleCapacity);

public sealed record ExcelImportResult(
    ScenarioInput? Input,
    Dictionary<string, string[]> Errors);

public sealed record AddressImportRow(int RowNumber, string Id, string Address);

public sealed record AddressExcelImportResult(
    List<AddressImportRow>? Persons,
    List<VehicleInput>? Vehicles,
    Dictionary<string, string[]> Errors);

/// <summary>
/// Excel'den senaryo girdisi üretir. Yüklenen dosya diske yazılmaz ve içeriği
/// loglanmaz; personel konumu kişisel veridir (docs/kararlar.md).
/// </summary>
public static class ScenarioExcelImport
{
    public const long MaxFileBytes = 5 * 1024 * 1024;
    public const string ContentType =
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

    private const string PersonSheetName = "personel";
    private const string VehicleSheetName = "araclar";

    private static readonly string[] IdHeaders = ["id", "kimlik"];
    private static readonly string[] LongitudeHeaders = ["boylam", "longitude", "lon", "lng"];
    private static readonly string[] LatitudeHeaders = ["enlem", "latitude", "lat"];
    private static readonly string[] AddressHeaders = ["adres", "address", "acik adres", "açık adres"];
    private static readonly string[] CapacityHeaders = ["kapasite", "capacity"];

    public static byte[] CreateTemplate()
    {
        using var workbook = new XLWorkbook();

        var personSheet = workbook.Worksheets.Add(PersonSheetName);
        personSheet.Cell(1, 1).Value = "id";
        personSheet.Cell(1, 2).Value = "adres";
        personSheet.Cell(2, 1).Value = "person-001";
        personSheet.Cell(2, 2).Value = "Kızılay Mahallesi, Çankaya, Ankara";
        personSheet.Row(1).Style.Font.Bold = true;
        personSheet.Columns().AdjustToContents();

        var vehicleSheet = workbook.Worksheets.Add(VehicleSheetName);
        vehicleSheet.Cell(1, 1).Value = "id";
        vehicleSheet.Cell(1, 2).Value = "kapasite";
        vehicleSheet.Cell(1, 3).Value = "boylam";
        vehicleSheet.Cell(1, 4).Value = "enlem";
        vehicleSheet.Cell(2, 1).Value = "vehicle-001";
        vehicleSheet.Cell(2, 2).Value = 16;
        vehicleSheet.Cell(2, 3).Value = 32.8541;
        vehicleSheet.Cell(2, 4).Value = 39.9208;
        vehicleSheet.Row(1).Style.Font.Bold = true;
        vehicleSheet.Columns().AdjustToContents();

        using var stream = new MemoryStream();
        workbook.SaveAs(stream);
        return stream.ToArray();
    }

    public static AddressExcelImportResult ParseAddresses(Stream stream, ExcelImportForm form)
    {
        var errors = new Dictionary<string, List<string>>(StringComparer.Ordinal);
        if (string.IsNullOrWhiteSpace(form.Name))
            Add(errors, "name", "Senaryo adı boş olamaz.");
        if (!ScenarioValidator.IsCoordinate(form.Workplace))
            Add(errors, "workplace", "İşyeri koordinatı geçerli olmalıdır.");

        XLWorkbook workbook;
        try
        {
            workbook = new XLWorkbook(stream);
        }
        catch (Exception exception)
        {
            Add(errors, "file", $"Excel dosyası okunamadı: {exception.Message}");
            return new AddressExcelImportResult(null, null, Build(errors));
        }

        using (workbook)
        {
            var sheet = FindSheet(workbook, PersonSheetName);
            var header = sheet?.FirstRowUsed();
            if (sheet is null || header is null)
            {
                Add(errors, "file", $"'{PersonSheetName}' sayfası bulunamadı veya boş.");
                return new AddressExcelImportResult(null, null, Build(errors));
            }

            var columns = ReadHeader(header);
            var idColumn = FindColumn(columns, IdHeaders);
            var addressColumn = FindColumn(columns, AddressHeaders);
            if (idColumn is null || addressColumn is null)
            {
                Add(errors, "file", $"'{PersonSheetName}' sayfasında 'id' ve 'adres' sütunları zorunludur.");
                return new AddressExcelImportResult(null, null, Build(errors));
            }

            var persons = new List<AddressImportRow>();
            var lastRow = sheet.LastRowUsed()?.RowNumber() ?? header.RowNumber();
            for (var rowNumber = header.RowNumber() + 1; rowNumber <= lastRow; rowNumber++)
            {
                var id = sheet.Cell(rowNumber, idColumn.Value).GetString().Trim();
                var address = sheet.Cell(rowNumber, addressColumn.Value).GetString().Trim();
                if (id.Length == 0 && address.Length == 0)
                    continue;
                if (id.Length == 0)
                    Add(errors, "persons", $"{rowNumber}. satırda id boş.");
                else if (address.Length == 0)
                    Add(errors, "persons", $"{rowNumber}. satırda adres boş.");
                else
                    persons.Add(new AddressImportRow(rowNumber, id, address));
            }

            if (persons.Count == 0)
                Add(errors, "persons", $"'{PersonSheetName}' sayfasında veri satırı bulunamadı.");

            var vehicles = ReadVehicles(workbook, form, errors);
            return new AddressExcelImportResult(persons, vehicles, Build(errors));
        }
    }

    public static ExcelImportResult Parse(Stream stream, ExcelImportForm form)
    {
        var errors = new Dictionary<string, List<string>>(StringComparer.Ordinal);

        if (string.IsNullOrWhiteSpace(form.Name))
            Add(errors, "name", "Senaryo adı boş olamaz.");

        if (!ScenarioValidator.IsCoordinate(form.Workplace))
            Add(errors, "workplace", "İşyeri koordinatı [boylam, enlem] sırasında ve geçerli aralıkta olmalıdır.");

        XLWorkbook workbook;

        try
        {
            workbook = new XLWorkbook(stream);
        }
        catch (Exception exception)
        {
            Add(errors, "file", $"Excel dosyası okunamadı: {exception.Message}");
            return new ExcelImportResult(null, Build(errors));
        }

        using (workbook)
        {
            var persons = ReadPersons(workbook, errors);
            var vehicles = ReadVehicles(workbook, form, errors);

            if (errors.Count > 0 || persons is null || vehicles is null)
                return new ExcelImportResult(null, Build(errors));

            var input = new ScenarioInput
            {
                Name = form.Name,
                Direction = "morning_inbound",
                Workplace = form.Workplace,
                ArrivalDeadline = form.ArrivalDeadline,
                Persons = persons,
                Vehicles = vehicles,
            };

            var validationErrors = ScenarioValidator.Validate(input);

            return validationErrors.Count > 0
                ? new ExcelImportResult(null, validationErrors)
                : new ExcelImportResult(input, new Dictionary<string, string[]>(StringComparer.Ordinal));
        }
    }

    private static List<PersonInput>? ReadPersons(
        XLWorkbook workbook,
        Dictionary<string, List<string>> errors)
    {
        var sheet = FindSheet(workbook, PersonSheetName);

        if (sheet is null)
        {
            Add(errors, "file", $"'{PersonSheetName}' sayfası bulunamadı.");
            return null;
        }

        var headerRow = sheet.FirstRowUsed();

        if (headerRow is null)
        {
            Add(errors, "file", $"'{PersonSheetName}' sayfası boş.");
            return null;
        }

        var columns = ReadHeader(headerRow);
        var idColumn = FindColumn(columns, IdHeaders);
        var longitudeColumn = FindColumn(columns, LongitudeHeaders);
        var latitudeColumn = FindColumn(columns, LatitudeHeaders);

        if (idColumn is null || longitudeColumn is null || latitudeColumn is null)
        {
            Add(errors, "file", $"'{PersonSheetName}' sayfasında 'id', 'boylam' ve 'enlem' sütunları zorunludur.");
            return null;
        }

        var persons = new List<PersonInput>();
        var lastRow = sheet.LastRowUsed()?.RowNumber() ?? headerRow.RowNumber();

        for (var rowNumber = headerRow.RowNumber() + 1; rowNumber <= lastRow; rowNumber++)
        {
            var row = sheet.Row(rowNumber);
            var id = row.Cell(idColumn.Value).GetString().Trim();

            if (string.IsNullOrEmpty(id))
                continue;

            if (!TryReadDouble(row.Cell(longitudeColumn.Value), out var longitude)
                || !TryReadDouble(row.Cell(latitudeColumn.Value), out var latitude))
            {
                Add(errors, "persons", $"{rowNumber}. satırdaki koordinat okunamadı.");
                continue;
            }

            persons.Add(new PersonInput(id, [longitude, latitude]));
        }

        if (persons.Count == 0)
            Add(errors, "persons", $"'{PersonSheetName}' sayfasında veri satırı bulunamadı.");

        return persons;
    }

    private static List<VehicleInput>? ReadVehicles(
        XLWorkbook workbook,
        ExcelImportForm form,
        Dictionary<string, List<string>> errors)
    {
        var sheet = FindSheet(workbook, VehicleSheetName);

        if (sheet is null)
            return BuildVehiclesFromForm(form, errors);

        var headerRow = sheet.FirstRowUsed();

        if (headerRow is null)
            return BuildVehiclesFromForm(form, errors);

        var columns = ReadHeader(headerRow);
        var idColumn = FindColumn(columns, IdHeaders);
        var capacityColumn = FindColumn(columns, CapacityHeaders);
        var longitudeColumn = FindColumn(columns, LongitudeHeaders);
        var latitudeColumn = FindColumn(columns, LatitudeHeaders);

        if (idColumn is null || capacityColumn is null)
        {
            Add(errors, "file", $"'{VehicleSheetName}' sayfasında 'id' ve 'kapasite' sütunları zorunludur.");
            return null;
        }

        var vehicles = new List<VehicleInput>();
        var lastRow = sheet.LastRowUsed()?.RowNumber() ?? headerRow.RowNumber();

        for (var rowNumber = headerRow.RowNumber() + 1; rowNumber <= lastRow; rowNumber++)
        {
            var row = sheet.Row(rowNumber);
            var id = row.Cell(idColumn.Value).GetString().Trim();

            if (string.IsNullOrEmpty(id))
                continue;

            if (!TryReadDouble(row.Cell(capacityColumn.Value), out var capacity))
            {
                Add(errors, "vehicles", $"{rowNumber}. satırdaki kapasite okunamadı.");
                continue;
            }

            var start = form.Workplace;

            if (longitudeColumn is not null
                && latitudeColumn is not null
                && TryReadDouble(row.Cell(longitudeColumn.Value), out var longitude)
                && TryReadDouble(row.Cell(latitudeColumn.Value), out var latitude))
            {
                start = [longitude, latitude];
            }

            vehicles.Add(new VehicleInput(id, (int)capacity, start));
        }

        if (vehicles.Count == 0)
            return BuildVehiclesFromForm(form, errors);

        return vehicles;
    }

    private static List<VehicleInput>? BuildVehiclesFromForm(
        ExcelImportForm form,
        Dictionary<string, List<string>> errors)
    {
        if (form.VehicleCount is not > 0 || form.VehicleCapacity is not > 0)
        {
            Add(
                errors,
                "vehicles",
                $"'{VehicleSheetName}' sayfası yoksa vehicleCount ve vehicleCapacity alanları zorunludur.");
            return null;
        }

        return Enumerable
            .Range(1, form.VehicleCount.Value)
            .Select(index => new VehicleInput(
                $"vehicle-{index:D3}",
                form.VehicleCapacity.Value,
                form.Workplace))
            .ToList();
    }

    private static IXLWorksheet? FindSheet(XLWorkbook workbook, string name) =>
        workbook.Worksheets.FirstOrDefault(sheet =>
            string.Equals(sheet.Name.Trim(), name, StringComparison.OrdinalIgnoreCase));

    private static Dictionary<string, int> ReadHeader(IXLRow headerRow)
    {
        var columns = new Dictionary<string, int>(StringComparer.Ordinal);

        foreach (var cell in headerRow.CellsUsed())
        {
            var key = cell.GetString().Trim().ToLowerInvariant();

            if (key.Length > 0 && !columns.ContainsKey(key))
                columns[key] = cell.Address.ColumnNumber;
        }

        return columns;
    }

    private static int? FindColumn(Dictionary<string, int> columns, string[] candidates)
    {
        foreach (var candidate in candidates)
        {
            if (columns.TryGetValue(candidate, out var column))
                return column;
        }

        return null;
    }

    /// <summary>
    /// Hücre sayısal değilse metin olarak okunur. Türkçe Excel çıktısında ondalık
    /// ayırıcı virgül olabildiği için her iki biçim de denenir.
    /// </summary>
    private static bool TryReadDouble(IXLCell cell, out double value)
    {
        if (cell.DataType == XLDataType.Number)
        {
            value = cell.GetDouble();
            return true;
        }

        var text = cell.GetString().Trim();

        if (text.Length == 0)
        {
            value = 0;
            return false;
        }

        if (double.TryParse(text, NumberStyles.Float, CultureInfo.InvariantCulture, out value))
            return true;

        return double.TryParse(text.Replace(',', '.'), NumberStyles.Float, CultureInfo.InvariantCulture, out value);
    }

    private static void Add(Dictionary<string, List<string>> errors, string key, string message)
    {
        if (!errors.TryGetValue(key, out var messages))
        {
            messages = [];
            errors[key] = messages;
        }

        messages.Add(message);
    }

    private static Dictionary<string, string[]> Build(Dictionary<string, List<string>> errors) =>
        errors.ToDictionary(entry => entry.Key, entry => entry.Value.ToArray(), StringComparer.Ordinal);
}
