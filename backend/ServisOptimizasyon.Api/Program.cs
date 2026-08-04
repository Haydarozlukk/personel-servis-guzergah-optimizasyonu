using System.Globalization;
using Npgsql;

var builder = WebApplication.CreateBuilder(args);

// 8 MB: Excel içe aktarımı için üst sınır (dosya başına 5 MB + form alanları).
builder.WebHost.ConfigureKestrel(options => options.Limits.MaxRequestBodySize = 8 * 1024 * 1024);

builder.Services.Configure<OptimizationOptions>(builder.Configuration.GetSection("Optimization"));

var geocodingOptions = builder.Configuration.GetSection("Geocoding").Get<GeocodingOptions>()
    ?? new GeocodingOptions();
builder.Services.AddSingleton(geocodingOptions);
builder.Services.AddHttpClient<IGeocodingService, NominatimGeocodingService>(client =>
{
    if (!string.IsNullOrWhiteSpace(geocodingOptions.BaseUrl))
        client.BaseAddress = new Uri(geocodingOptions.BaseUrl.TrimEnd('/') + "/");
    client.Timeout = TimeSpan.FromSeconds(30);
    client.DefaultRequestHeaders.UserAgent.ParseAdd("ServisOptimizasyon/1.0");
});

var allowedOrigins = (builder.Configuration["Cors:AllowedOrigins"] ?? string.Empty)
    .Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);

builder.Services.AddCors(options => options.AddDefaultPolicy(policy =>
{
    if (allowedOrigins.Length > 0)
        policy.WithOrigins(allowedOrigins).AllowAnyHeader().AllowAnyMethod();
    else
        policy.AllowAnyOrigin().AllowAnyHeader().AllowAnyMethod();
}));

var optimizationTimeout = TimeSpan.FromSeconds(
    builder.Configuration.GetValue("Services:OptimizationTimeoutSeconds", 600));
var vroomTimeout = TimeSpan.FromSeconds(
    builder.Configuration.GetValue("Services:VroomTimeoutSeconds", 300));

builder.Services.AddHttpClient<OptimizationClient>(client =>
{
    client.BaseAddress = new Uri(builder.Configuration["Services:OptimizationUrl"]
        ?? "http://optimization:8000");
    client.Timeout = optimizationTimeout;
});
builder.Services.AddHttpClient<VroomClient>(client =>
{
    client.BaseAddress = new Uri(builder.Configuration["Services:VroomUrl"] ?? "http://vroom:3000");
    client.Timeout = vroomTimeout;
});

builder.Services.AddScoped<ScenarioOrchestrator>();
builder.Services.AddSingleton<ScenarioQueue>();
builder.Services.AddHostedService<ScenarioWorker>();

var connectionString = builder.Configuration.GetConnectionString("Postgres");

if (string.IsNullOrWhiteSpace(connectionString))
{
    builder.Services.AddSingleton<IScenarioStore, InMemoryScenarioStore>();
}
else
{
    builder.Services.AddSingleton(_ => new NpgsqlDataSourceBuilder(connectionString).Build());
    builder.Services.AddSingleton<IScenarioStore, PostgresScenarioStore>();
}

builder.Services.AddHealthChecks();

var app = builder.Build();

if (string.IsNullOrWhiteSpace(connectionString))
{
    app.Logger.LogWarning(
        "ConnectionStrings:Postgres tanımlı değil; bellek içi depo kullanılıyor. "
        + "Senaryolar süreç yeniden başladığında kaybolur.");
}

if (allowedOrigins.Length == 0)
{
    app.Logger.LogWarning(
        "Cors:AllowedOrigins tanımlı değil; tüm kaynaklara izin veriliyor. "
        + "Üretim benzeri ortamda ALLOWED_ORIGINS ayarlanmalıdır.");
}

await EnsureSchemaWithRetryAsync(app);

app.UseCors();

app.MapHealthChecks("/health");

app.MapGet("/health/ready", async (IScenarioStore store, CancellationToken cancellationToken) =>
{
    try
    {
        await store.PingAsync(cancellationToken);
        return Results.Ok(new { status = "ready" });
    }
    catch (Exception exception)
    {
        return Results.Json(
            new { status = "unavailable", error = exception.Message },
            statusCode: StatusCodes.Status503ServiceUnavailable);
    }
});

app.MapPost("/api/v1/scenarios", async (
    ScenarioInput input,
    IScenarioStore store,
    ScenarioQueue queue,
    CancellationToken cancellationToken) =>
{
    var errors = ScenarioValidator.Validate(input);

    if (errors.Count > 0)
        return Results.ValidationProblem(errors);

    var scenarioId = Guid.NewGuid();
    await store.CreateAsync(scenarioId, input, cancellationToken);
    await queue.EnqueueAsync(new ScenarioJob(scenarioId, ScenarioJobKind.FullOptimization), cancellationToken);

    return Results.Accepted(
        $"/api/v1/scenarios/{scenarioId}",
        new ScenarioAccepted(scenarioId, ScenarioStatus.Queued));
});

app.MapGet("/api/v1/scenarios/import/template", () => Results.File(
    ScenarioExcelImport.CreateTemplate(),
    ScenarioExcelImport.ContentType,
    "senaryo-sablonu.xlsx"));

app.MapPost("/api/v1/scenarios/import", async (
    HttpRequest request,
    IScenarioStore store,
    ScenarioQueue queue,
    IGeocodingService geocodingService,
    GeocodingOptions geocodingConfiguration,
    CancellationToken cancellationToken) =>
{
    if (!request.HasFormContentType)
        return Results.ValidationProblem(new Dictionary<string, string[]>
        {
            ["file"] = ["İstek multipart/form-data olmalıdır."],
        });

    var form = await request.ReadFormAsync(cancellationToken);
    var file = form.Files["file"];

    if (file is null || file.Length == 0)
        return Results.ValidationProblem(new Dictionary<string, string[]>
        {
            ["file"] = ["Excel dosyası zorunludur."],
        });

    if (file.Length > ScenarioExcelImport.MaxFileBytes)
        return Results.Json(
            new { title = "Dosya çok büyük.", maxBytes = ScenarioExcelImport.MaxFileBytes },
            statusCode: StatusCodes.Status413PayloadTooLarge);

    if (string.IsNullOrWhiteSpace(geocodingConfiguration.BaseUrl))
        return Results.Json(
            new
            {
                title = "Geocoding servisi yapılandırılmamış.",
                detail = "Geocoding:BaseUrl ayarlanmalıdır.",
            },
            statusCode: StatusCodes.Status503ServiceUnavailable);

    var formErrors = new Dictionary<string, string[]>(StringComparer.Ordinal);

    if (!TimeOnly.TryParse(
            form["arrivalDeadline"].ToString(),
            CultureInfo.InvariantCulture,
            out var arrivalDeadline))
    {
        formErrors["arrivalDeadline"] = ["Varış saati 'HH:mm:ss' biçiminde olmalıdır."];
    }

    var workplaceAddress = form["workplaceAddress"].ToString().Trim();
    if (string.IsNullOrWhiteSpace(workplaceAddress))
        formErrors["workplaceAddress"] = ["İşyeri adresi zorunludur."];

    if (formErrors.Count > 0)
        return Results.ValidationProblem(formErrors);

    GeocodingResult? workplace;
    try
    {
        workplace = await geocodingService.GeocodeAsync(workplaceAddress, cancellationToken);
    }
    catch (Exception exception)
    {
        return Results.ValidationProblem(new Dictionary<string, string[]>
        {
            ["workplaceAddress"] = [$"İşyeri adresi geocoding hatası: {exception.Message}"],
        });
    }

    if (workplace is null)
        return Results.ValidationProblem(new Dictionary<string, string[]>
        {
            ["workplaceAddress"] = ["İşyeri adresi için koordinat bulunamadı."],
        });

    var importForm = new ExcelImportForm(
        form["name"].ToString(),
        arrivalDeadline,
        [workplace.Longitude, workplace.Latitude],
        TryParseInt(form["vehicleCount"].ToString()),
        TryParseInt(form["vehicleCapacity"].ToString()));

    await using var stream = file.OpenReadStream();
    var import = ScenarioExcelImport.ParseAddresses(stream, importForm);

    if (import.Persons is null || import.Vehicles is null || import.Errors.Count > 0)
        return Results.ValidationProblem(import.Errors);

    var geocoded = await GeocodePersonsAsync(
        import.Persons,
        geocodingService,
        geocodingConfiguration.MaxConcurrency,
        cancellationToken);
    if (geocoded.Errors.Count > 0)
        return Results.ValidationProblem(new Dictionary<string, string[]>
        {
            ["persons"] = geocoded.Errors.ToArray(),
        });

    var input = new ScenarioInput
    {
        Name = importForm.Name,
        Direction = "morning_inbound",
        Workplace = importForm.Workplace,
        ArrivalDeadline = importForm.ArrivalDeadline,
        Persons = geocoded.Persons,
        Vehicles = import.Vehicles,
    };
    var validationErrors = ScenarioValidator.Validate(input);
    if (validationErrors.Count > 0)
        return Results.ValidationProblem(validationErrors);

    var scenarioId = Guid.NewGuid();
    await store.CreateAsync(scenarioId, input, cancellationToken);
    await queue.EnqueueAsync(new ScenarioJob(scenarioId, ScenarioJobKind.FullOptimization), cancellationToken);

    return Results.Accepted(
        $"/api/v1/scenarios/{scenarioId}",
        new ScenarioAccepted(scenarioId, ScenarioStatus.Queued));
});

app.MapGet("/api/v1/scenarios/{scenarioId:guid}", async (
    Guid scenarioId,
    IScenarioStore store,
    CancellationToken cancellationToken) =>
{
    var result = await store.TryGetResultAsync(scenarioId, cancellationToken);

    return result is null
        ? Results.NotFound(new { scenarioId, message = "Senaryo bulunamadı." })
        : Results.Ok(result);
});

app.MapPost("/api/v1/scenarios/{scenarioId:guid}/reoptimize", async (
    Guid scenarioId,
    ReoptimizeRequest? body,
    IScenarioStore store,
    ScenarioQueue queue,
    CancellationToken cancellationToken) =>
{
    var vehicles = body?.Vehicles;

    if (vehicles is { Count: > 0 })
    {
        var errors = ScenarioValidator.ValidateVehiclesOnly(vehicles);

        if (errors.Count > 0)
            return Results.ValidationProblem(errors);
    }

    if (await store.TryGetInputAsync(scenarioId, cancellationToken) is null)
        return Results.NotFound(new { scenarioId, message = "Senaryo bulunamadı." });

    if (!await store.PrepareReoptimizeAsync(scenarioId, vehicles, cancellationToken))
        return Results.Conflict(new
        {
            scenarioId,
            message = "Senaryonun kayıtlı durağı yok; önce tam optimizasyon çalışmalıdır.",
        });

    await queue.EnqueueAsync(new ScenarioJob(scenarioId, ScenarioJobKind.RouteOnly), cancellationToken);

    return Results.Accepted(
        $"/api/v1/scenarios/{scenarioId}",
        new ScenarioAccepted(scenarioId, ScenarioStatus.Queued));
});

app.Run();

static int? TryParseInt(string? value) =>
    int.TryParse(value, NumberStyles.Integer, CultureInfo.InvariantCulture, out var parsed) ? parsed : null;

static async Task<(List<PersonInput> Persons, List<string> Errors)> GeocodePersonsAsync(
    List<AddressImportRow> rows,
    IGeocodingService geocodingService,
    int maxConcurrency,
    CancellationToken cancellationToken)
{
    var persons = new PersonInput?[rows.Count];
    var errors = new string?[rows.Count];
    using var gate = new SemaphoreSlim(Math.Clamp(maxConcurrency, 1, 10));

    await Task.WhenAll(rows.Select(async (row, index) =>
    {
        await gate.WaitAsync(cancellationToken);
        try
        {
            var result = await geocodingService.GeocodeAsync(row.Address, cancellationToken);
            if (result is null)
                errors[index] = $"{row.RowNumber}. satırdaki adres bulunamadı (id: {row.Id}).";
            else
                persons[index] = new PersonInput(row.Id, [result.Longitude, result.Latitude]);
        }
        catch (HttpRequestException exception)
        {
            errors[index] = $"{row.RowNumber}. satır geocoding hatası (id: {row.Id}): {exception.Message}";
        }
        finally
        {
            gate.Release();
        }
    }));

    return (
        persons.Where(person => person is not null).Select(person => person!).ToList(),
        errors.Where(error => error is not null).Select(error => error!).ToList());
}

static async Task EnsureSchemaWithRetryAsync(WebApplication app)
{
    using var scope = app.Services.CreateScope();
    var store = scope.ServiceProvider.GetRequiredService<IScenarioStore>();

    for (var attempt = 1; attempt <= 10; attempt++)
    {
        try
        {
            await store.EnsureSchemaAsync(CancellationToken.None);
            return;
        }
        catch (Exception exception) when (attempt < 10)
        {
            app.Logger.LogWarning(
                exception,
                "Veritabanı şeması hazırlanamadı ({Attempt}/10), 3 saniye sonra yeniden denenecek.",
                attempt);
            await Task.Delay(TimeSpan.FromSeconds(3));
        }
    }

    await store.EnsureSchemaAsync(CancellationToken.None);
}

public partial class Program;
