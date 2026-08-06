using ClosedXML.Excel;
using Xunit;

public class ScenarioExcelImportTests
{
    private static readonly ExcelImportForm DefaultForm = new(
        "Excel senaryosu",
        new TimeOnly(8, 30),
        [32.8541, 39.9208],
        VehicleCount: null,
        VehicleCapacity: null);

    private static MemoryStream Workbook(Action<XLWorkbook> configure)
    {
        var stream = new MemoryStream();

        using (var workbook = new XLWorkbook())
        {
            configure(workbook);
            workbook.SaveAs(stream);
        }

        stream.Position = 0;
        return stream;
    }

    private static void AddPersonSheet(XLWorkbook workbook)
    {
        var sheet = workbook.Worksheets.Add("personel");
        sheet.Cell(1, 1).Value = "sicil numarası";
        sheet.Cell(1, 2).Value = "boylam";
        sheet.Cell(1, 3).Value = "enlem";
        sheet.Cell(2, 1).Value = "10234";
        sheet.Cell(2, 2).Value = 32.8597;
        sheet.Cell(2, 3).Value = 39.9334;
        sheet.Cell(3, 1).Value = "10235";
        sheet.Cell(3, 2).Value = 32.8642;
        sheet.Cell(3, 3).Value = 39.9261;
    }

    [Fact]
    public void PersonSheetIsParsed()
    {
        using var stream = Workbook(AddPersonSheet);

        var result = ScenarioExcelImport.Parse(
            stream,
            DefaultForm with { VehicleCount = 2, VehicleCapacity = 18 });

        Assert.Empty(result.Errors);
        Assert.NotNull(result.Input);
        Assert.Equal(2, result.Input.Persons.Count);
        Assert.Equal("10234", result.Input.Persons[0].Id);
        Assert.Equal(32.8597, result.Input.Persons[0].Location[0]);
        Assert.Equal("morning_inbound", result.Input.Direction);
    }

    [Fact]
    public void MissingPersonSheetIsReported()
    {
        using var stream = Workbook(workbook => workbook.Worksheets.Add("baska"));

        var result = ScenarioExcelImport.Parse(stream, DefaultForm);

        Assert.Null(result.Input);
        Assert.Contains("file", result.Errors.Keys);
    }

    [Fact]
    public void VehicleSheetIsParsedWhenPresent()
    {
        using var stream = Workbook(workbook =>
        {
            AddPersonSheet(workbook);
            var sheet = workbook.Worksheets.Add("araclar");
            sheet.Cell(1, 1).Value = "plaka";
            sheet.Cell(1, 2).Value = "kapasite";
            sheet.Cell(1, 3).Value = "boylam";
            sheet.Cell(1, 4).Value = "enlem";
            sheet.Cell(2, 1).Value = "06 ABC 123";
            sheet.Cell(2, 2).Value = 30;
            sheet.Cell(2, 3).Value = 32.8100;
            sheet.Cell(2, 4).Value = 39.9700;
        });

        var result = ScenarioExcelImport.Parse(stream, DefaultForm);

        Assert.Empty(result.Errors);
        var vehicle = Assert.Single(result.Input!.Vehicles);
        Assert.Equal("06 ABC 123", vehicle.Id);
        Assert.Equal(30, vehicle.Capacity);
        Assert.Equal(32.8100, vehicle.Start![0]);
    }

    [Fact]
    public void VehiclesAreGeneratedFromFormWhenSheetIsMissing()
    {
        using var stream = Workbook(AddPersonSheet);

        var result = ScenarioExcelImport.Parse(
            stream,
            DefaultForm with { VehicleCount = 3, VehicleCapacity = 18 });

        Assert.Empty(result.Errors);
        Assert.Equal(3, result.Input!.Vehicles.Count);
        Assert.Equal("vehicle-001", result.Input.Vehicles[0].Id);
        Assert.Equal(18, result.Input.Vehicles[0].Capacity);
        // Araç sayfası yoksa araçlar işyerinden başlar.
        Assert.Equal(32.8541, result.Input.Vehicles[0].Start![0]);
    }

    [Fact]
    public void MissingVehicleInformationIsReported()
    {
        using var stream = Workbook(AddPersonSheet);

        var result = ScenarioExcelImport.Parse(stream, DefaultForm);

        Assert.Null(result.Input);
        Assert.Contains("vehicles", result.Errors.Keys);
    }

    /// <summary>Türkçe Excel çıktısında ondalık ayırıcı virgül olabilir.</summary>
    [Fact]
    public void CommaDecimalSeparatorIsAccepted()
    {
        using var stream = Workbook(workbook =>
        {
            var sheet = workbook.Worksheets.Add("personel");
            sheet.Cell(1, 1).Value = "sicil numarası";
            sheet.Cell(1, 2).Value = "boylam";
            sheet.Cell(1, 3).Value = "enlem";
            sheet.Cell(2, 1).Value = "10234";
            sheet.Cell(2, 2).Value = "32,8597";
            sheet.Cell(2, 3).Value = "39,9334";
        });

        var result = ScenarioExcelImport.Parse(
            stream,
            DefaultForm with { VehicleCount = 1, VehicleCapacity = 18 });

        Assert.Empty(result.Errors);
        Assert.Equal(32.8597, result.Input!.Persons[0].Location[0], 4);
        Assert.Equal(39.9334, result.Input.Persons[0].Location[1], 4);
    }

    [Fact]
    public void InvalidCoordinatesAreRejected()
    {
        using var stream = Workbook(workbook =>
        {
            var sheet = workbook.Worksheets.Add("personel");
            sheet.Cell(1, 1).Value = "sicil numarası";
            sheet.Cell(1, 2).Value = "boylam";
            sheet.Cell(1, 3).Value = "enlem";
            sheet.Cell(2, 1).Value = "10234";
            sheet.Cell(2, 2).Value = 999.0;
            sheet.Cell(2, 3).Value = 39.9334;
        });

        var result = ScenarioExcelImport.Parse(
            stream,
            DefaultForm with { VehicleCount = 1, VehicleCapacity = 18 });

        Assert.Null(result.Input);
        Assert.Contains("persons", result.Errors.Keys);
    }

    [Fact]
    public void GeneratedTemplateCanBeParsedBack()
    {
        using var stream = new MemoryStream(ScenarioExcelImport.CreateTemplate());

        var result = ScenarioExcelImport.ParseAddresses(stream, DefaultForm);

        Assert.Empty(result.Errors);
        var person = Assert.Single(result.Persons!);
        Assert.Equal("10234", person.Id);
        Assert.Equal("Ahmet Yılmaz", person.Name);
        Assert.Contains("Ankara", person.Address);

        Assert.Empty(result.Vehicles!);
        Assert.Null(result.VehicleAddressRows);

        stream.Position = 0;
        var settings = ScenarioExcelImport.ReadSettings(stream);
        Assert.Equal(new TimeOnly(8, 30), settings.ArrivalDeadline);
    }

    [Fact]
    public void AddressRowsReportTheirExcelRowNumber()
    {
        using var stream = Workbook(workbook =>
        {
            var sheet = workbook.Worksheets.Add("personel");
            sheet.Cell(1, 1).Value = "sicil numarası";
            sheet.Cell(1, 2).Value = "ad soyad";
            sheet.Cell(1, 3).Value = "adres";
            sheet.Cell(2, 1).Value = "10234";
            sheet.Cell(2, 2).Value = "Ahmet Yılmaz";
            sheet.Cell(2, 3).Value = "Kızılay, Çankaya, Ankara";
            sheet.Cell(3, 1).Value = "10235";
        });

        var result = ScenarioExcelImport.ParseAddresses(
            stream,
            DefaultForm with { VehicleCount = 1, VehicleCapacity = 18 });

        Assert.Contains(result.Errors["persons"], message => message.Contains("3. satır"));
        var person = Assert.Single(result.Persons!);
        Assert.Equal(2, person.RowNumber);
    }
}
