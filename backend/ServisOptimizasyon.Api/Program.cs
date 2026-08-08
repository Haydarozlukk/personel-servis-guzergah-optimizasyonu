using System.Globalization;
using System.Security.Claims;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.AspNetCore.Identity;
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
        policy.WithOrigins(allowedOrigins).AllowAnyHeader().AllowAnyMethod().AllowCredentials();
    else
        policy.SetIsOriginAllowed(_ => true).AllowAnyHeader().AllowAnyMethod().AllowCredentials();
}));

builder.Services
    .AddAuthentication(CookieAuthenticationDefaults.AuthenticationScheme)
    .AddCookie(options =>
    {
        options.Cookie.Name = "servis_session";
        options.Cookie.HttpOnly = true;
        options.Cookie.SameSite = SameSiteMode.Lax;
        options.Cookie.SecurePolicy = CookieSecurePolicy.SameAsRequest;
        options.SlidingExpiration = true;
        options.ExpireTimeSpan = TimeSpan.FromHours(12);
        options.Events.OnRedirectToLogin = context =>
        {
            context.Response.StatusCode = StatusCodes.Status401Unauthorized;
            return Task.CompletedTask;
        };
        options.Events.OnRedirectToAccessDenied = context =>
        {
            context.Response.StatusCode = StatusCodes.Status403Forbidden;
            return Task.CompletedTask;
        };
    });
builder.Services.AddAuthorization();
builder.Services.AddSingleton<IPasswordHasher<AppUser>, PasswordHasher<AppUser>>();

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
builder.Services.AddHttpClient<OsrmCarClient>(client =>
{
    client.BaseAddress = new Uri(builder.Configuration["Services:OsrmCarUrl"] ?? "http://osrm-car:5000");
    client.Timeout = TimeSpan.FromSeconds(15);
});

var restrictedAreasPath = builder.Configuration["RestrictedAreas:FilePath"];
var restrictedAreaChecker = File.Exists(restrictedAreasPath)
    ? RestrictedAreaChecker.Load(restrictedAreasPath!)
    : RestrictedAreaChecker.Empty;
builder.Services.AddSingleton(restrictedAreaChecker);

builder.Services.AddScoped<ScenarioOrchestrator>();
builder.Services.AddSingleton<ScenarioQueue>();
builder.Services.AddHostedService<ScenarioWorker>();

var connectionString = builder.Configuration.GetConnectionString("Postgres");

if (string.IsNullOrWhiteSpace(connectionString))
{
    builder.Services.AddSingleton<IScenarioStore, InMemoryScenarioStore>();
    builder.Services.AddSingleton<IUserStore, InMemoryUserStore>();
    builder.Services.AddSingleton<IPlanVersionStore, InMemoryPlanVersionStore>();
}
else
{
    builder.Services.AddSingleton(_ => new NpgsqlDataSourceBuilder(connectionString).Build());
    builder.Services.AddSingleton<IScenarioStore, PostgresScenarioStore>();
    builder.Services.AddSingleton<IUserStore, PostgresUserStore>();
    builder.Services.AddSingleton<IPlanVersionStore, PostgresPlanVersionStore>();
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

if (restrictedAreaChecker.Areas.Count == 0)
{
    app.Logger.LogWarning(
        "Halka kapalı alan tanımı yüklenemedi ({Path}); rotalar bu alanlara karşı denetlenmeyecek.",
        restrictedAreasPath);
}
else
{
    app.Logger.LogInformation(
        "{Count} halka kapalı alan yüklendi.",
        restrictedAreaChecker.Areas.Count);
}

await EnsureSchemaWithRetryAsync(app);

app.UseCors();
app.UseAuthentication();
app.UseAuthorization();

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

app.MapPost("/api/v1/auth/register", () =>
    Results.Json(new { message = "Kayıt olma sistemi kaldırılmıştır. Yeni kullanıcılar yalnızca Admin tarafından eklenebilir." }, statusCode: StatusCodes.Status403Forbidden));

app.MapPost("/api/v1/auth/login", async (
    LoginRequest request,
    HttpContext context,
    IUserStore users,
    IPasswordHasher<AppUser> hasher,
    CancellationToken cancellationToken) =>
{
    var user = await users.FindByEmailAsync(request.Email, cancellationToken);
    if (user is null || user.Status == UserStatuses.Deleted)
        return Results.Unauthorized();
    if (user.Status != UserStatuses.Approved)
        return Results.Json(new { message = "Hesabınız admin onayı bekliyor." }, statusCode: StatusCodes.Status403Forbidden);
    if (hasher.VerifyHashedPassword(user, user.PasswordHash, request.Password) == PasswordVerificationResult.Failed)
        return Results.Unauthorized();

    await context.SignInAsync(
        CookieAuthenticationDefaults.AuthenticationScheme,
        UserAccountHelpers.CreatePrincipal(user),
        new AuthenticationProperties { IsPersistent = true });
    return Results.Ok(user.ToResult());
});

app.MapPost("/api/v1/auth/logout", async (HttpContext context) =>
{
    await context.SignOutAsync(CookieAuthenticationDefaults.AuthenticationScheme);
    return Results.NoContent();
}).RequireAuthorization();

app.MapGet("/api/v1/auth/me", async (
    ClaimsPrincipal principal,
    IUserStore users,
    CancellationToken cancellationToken) =>
{
    var email = principal.FindFirstValue(ClaimTypes.Email);
    var user = email is null ? null : await users.FindByEmailAsync(email, cancellationToken);
    return user is { Status: UserStatuses.Approved } ? Results.Ok(user.ToResult()) : Results.Unauthorized();
}).RequireAuthorization();

app.MapGet("/api/v1/admin/users", async (IUserStore users, CancellationToken cancellationToken) =>
    Results.Ok((await users.ListAsync(cancellationToken)).Select(user => user.ToResult())))
    .RequireAuthorization(policy => policy.RequireRole(UserRoles.Admin));

app.MapPost("/api/v1/admin/users", async (
    AdminCreateUserRequest request,
    IUserStore users,
    IPasswordHasher<AppUser> hasher,
    CancellationToken cancellationToken) =>
{
    var errors = UserAccountHelpers.Validate(new RegisterRequest(request.Email, request.DisplayName, request.Password));
    if (errors.Count > 0) return Results.ValidationProblem(errors);

    var role = string.Equals(request.Role, UserRoles.Admin, StringComparison.OrdinalIgnoreCase) ? UserRoles.Admin : UserRoles.Expert;
    var now = DateTimeOffset.UtcNow;
    var user = new AppUser(
        Guid.NewGuid(), request.Email.Trim(), request.DisplayName.Trim(), string.Empty,
        role, UserStatuses.Approved, now, now);
    user = user with { PasswordHash = hasher.HashPassword(user, request.Password) };

    return await users.CreateAsync(user, cancellationToken)
        ? Results.Json(user.ToResult(), statusCode: StatusCodes.Status201Created)
        : Results.Conflict(new { message = "Bu e-posta ile daha önce kullanıcı oluşturulmuş." });
}).RequireAuthorization(policy => policy.RequireRole(UserRoles.Admin));

app.MapPost("/api/v1/admin/users/{userId:guid}/approve", async (
    Guid userId,
    IUserStore users,
    CancellationToken cancellationToken) =>
    await users.ApproveAsync(userId, cancellationToken) ? Results.NoContent() : Results.NotFound())
    .RequireAuthorization(policy => policy.RequireRole(UserRoles.Admin));

app.MapDelete("/api/v1/admin/users/{userId:guid}", async (
    Guid userId,
    IUserStore users,
    CancellationToken cancellationToken) =>
    await users.SoftDeleteAsync(userId, cancellationToken) ? Results.NoContent() : Results.NotFound())
    .RequireAuthorization(policy => policy.RequireRole(UserRoles.Admin));

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
    await queue.EnqueueAsync(new ScenarioJob(scenarioId), cancellationToken);

    return Results.Accepted(
        $"/api/v1/scenarios/{scenarioId}",
        new ScenarioAccepted(scenarioId, ScenarioStatus.Queued));
}).RequireAuthorization();

app.MapGet("/api/v1/scenarios/import/template", () => Results.File(
    ScenarioExcelImport.CreateTemplate(),
    ScenarioExcelImport.ContentType,
    "senaryo-sablonu.xlsx")).RequireAuthorization();

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

    byte[] workbookBytes;
    await using (var fileStream = file.OpenReadStream())
    using (var buffer = new MemoryStream())
    {
        await fileStream.CopyToAsync(buffer, cancellationToken);
        workbookBytes = buffer.ToArray();
    }

    ScenarioExcelSettings excelSettings;
    try
    {
        excelSettings = ScenarioExcelImport.ReadSettings(new MemoryStream(workbookBytes));
    }
    catch (Exception exception)
    {
        return Results.ValidationProblem(new Dictionary<string, string[]>
        {
            ["file"] = [$"Excel ayarları okunamadı: {exception.Message}"],
        });
    }

    var formErrors = new Dictionary<string, string[]>(StringComparer.Ordinal);
    var arrivalText = form["arrivalDeadline"].ToString();

    if (string.IsNullOrWhiteSpace(arrivalText) && excelSettings.ArrivalDeadline.HasValue)
        arrivalText = excelSettings.ArrivalDeadline.Value.ToString("HH:mm:ss", CultureInfo.InvariantCulture);
    if (!TimeOnly.TryParse(arrivalText, CultureInfo.InvariantCulture, out var arrivalDeadline))
    {
        formErrors["arrivalDeadline"] = ["Varış saati 'HH:mm:ss' biçiminde olmalıdır."];
    }

    var destinationAddress = form["destinationAddress"].ToString().Trim();
    if (destinationAddress.Length == 0)
        destinationAddress = form["workplaceAddress"].ToString().Trim();
    if (destinationAddress.Length == 0)
        destinationAddress = excelSettings.DestinationAddress?.Trim() ?? string.Empty;
    if (string.IsNullOrWhiteSpace(destinationAddress))
        formErrors["destinationAddress"] = ["Varış adresi ekrandan veya Excel 'ayarlar' sayfasından girilmelidir."];

    if (formErrors.Count > 0)
        return Results.ValidationProblem(formErrors);

    GeocodingResult? destination;
    try
    {
        destination = await geocodingService.GeocodeAsync(destinationAddress, cancellationToken);
    }
    catch (Exception exception)
    {
        return Results.ValidationProblem(new Dictionary<string, string[]>
        {
            ["destinationAddress"] = [$"Varış adresi geocoding hatası: {exception.Message}"],
        });
    }

    if (destination is null)
        return Results.ValidationProblem(new Dictionary<string, string[]>
        {
            ["destinationAddress"] = ["Varış adresi için koordinat bulunamadı."],
        });

    var importForm = new ExcelImportForm(
        form["name"].ToString(),
        arrivalDeadline,
        [destination.Longitude, destination.Latitude],
        null,
        null);

    var import = ScenarioExcelImport.ParseAddresses(new MemoryStream(workbookBytes), importForm);

    if (import.Persons is null || import.Errors.Count > 0)
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
    if (geocoded.Persons.Count == 0)
        return Results.ValidationProblem(new Dictionary<string, string[]>
        {
            ["persons"] = ["Excel'deki adreslerin hiçbiri güvenilir biçimde eşleştirilemedi."],
        });

    var importWarnings = geocoded.Skipped.Count == 0
        ? new List<string>()
        :
        [
            $"Excel içe aktarımı: {geocoded.Skipped.Count} adres güvenilir biçimde eşleştirilemediği için çıkarıldı. "
            + string.Join(" ", geocoded.Skipped),
        ];

    var vehicles = FleetPlanner.Create(geocoded.Persons.Count, importForm.Workplace);

    var input = new ScenarioInput
    {
        Name = importForm.Name,
        Direction = "morning_inbound",
        Workplace = importForm.Workplace,
        ArrivalDeadline = importForm.ArrivalDeadline,
        Persons = geocoded.Persons,
        Vehicles = vehicles,
        ImportWarnings = importWarnings,
    };
    var validationErrors = ScenarioValidator.Validate(input);
    if (validationErrors.Count > 0)
        return Results.ValidationProblem(validationErrors);

    var scenarioId = Guid.NewGuid();
    await store.CreateAsync(scenarioId, input, cancellationToken);
    await queue.EnqueueAsync(new ScenarioJob(scenarioId), cancellationToken);

    return Results.Accepted(
        $"/api/v1/scenarios/{scenarioId}",
        new ScenarioAccepted(scenarioId, ScenarioStatus.Queued));
}).RequireAuthorization();

app.MapPost("/api/v1/scenarios/{scenarioId:guid}/import-append", async (
    Guid scenarioId,
    HttpRequest request,
    IGeocodingService geocodingService,
    GeocodingOptions geocodingConfiguration,
    CancellationToken cancellationToken) =>
{
    if (!request.HasFormContentType)
        return Results.ValidationProblem(new Dictionary<string, string[]> { ["file"] = ["İstek multipart/form-data olmalıdır."] });

    var form = await request.ReadFormAsync(cancellationToken);
    var file = form.Files["file"];
    if (file is null || file.Length == 0)
        return Results.ValidationProblem(new Dictionary<string, string[]> { ["file"] = ["Excel dosyası zorunludur."] });

    if (file.Length > ScenarioExcelImport.MaxFileBytes)
        return Results.Json(new { title = "Dosya çok büyük.", maxBytes = ScenarioExcelImport.MaxFileBytes }, statusCode: StatusCodes.Status413PayloadTooLarge);

    if (string.IsNullOrWhiteSpace(geocodingConfiguration.BaseUrl))
        return Results.Json(new { title = "Geocoding servisi yapılandırılmamış." }, statusCode: StatusCodes.Status503ServiceUnavailable);

    byte[] workbookBytes;
    await using (var fileStream = file.OpenReadStream())
    using (var buffer = new MemoryStream())
    {
        await fileStream.CopyToAsync(buffer, cancellationToken);
        workbookBytes = buffer.ToArray();
    }

    var importForm = new ExcelImportForm("Excel İçe Aktarımı", new TimeOnly(8, 30), [32.8597, 39.9334], null, null);
    var import = ScenarioExcelImport.ParseAddresses(new MemoryStream(workbookBytes), importForm);
    if (import.Persons is null || import.Errors.Count > 0)
        return Results.ValidationProblem(import.Errors);

    var geocoded = await GeocodePersonsAsync(import.Persons, geocodingService, geocodingConfiguration.MaxConcurrency, cancellationToken);
    if (geocoded.Persons.Count == 0)
        return Results.ValidationProblem(new Dictionary<string, string[]> { ["persons"] = ["Excel'deki adreslerin hiçbiri güvenilir biçimde eşleştirilemedi."] });

    return Results.Ok(new { persons = geocoded.Persons, skippedCount = geocoded.Skipped.Count });
}).RequireAuthorization();

app.MapGet("/api/v1/scenarios/latest", async (
    IScenarioStore store,
    IPlanVersionStore versions,
    CancellationToken cancellationToken) =>
{
    var scenarioId = await store.TryGetLatestScenarioIdAsync(cancellationToken);
    if (scenarioId is null) return Results.NotFound();
    var result = await versions.TryGetActivePlanAsync(scenarioId.Value, cancellationToken)
        ?? await store.TryGetResultAsync(scenarioId.Value, cancellationToken);
    return result is null ? Results.NotFound() : Results.Ok(result);
}).RequireAuthorization();

app.MapGet("/api/v1/scenarios/{scenarioId:guid}", async (
    Guid scenarioId,
    IScenarioStore store,
    IPlanVersionStore versions,
    CancellationToken cancellationToken) =>
{
    var result = await versions.TryGetActivePlanAsync(scenarioId, cancellationToken)
        ?? await store.TryGetResultAsync(scenarioId, cancellationToken);

    return result is null
        ? Results.NotFound(new { scenarioId, message = "Senaryo bulunamadı." })
        : Results.Ok(result);
}).RequireAuthorization();

app.MapGet("/api/v1/restricted-areas", (RestrictedAreaChecker restrictedAreas) =>
    Results.Content(restrictedAreas.GeoJson, "application/geo+json"))
    .RequireAuthorization();

app.MapPut("/api/v1/scenarios/{scenarioId:guid}/active-plan", async (
    Guid scenarioId,
    ScenarioResult plan,
    IScenarioStore store,
    IPlanVersionStore versions,
    OsrmCarClient osrmClient,
    RestrictedAreaChecker restrictedAreas,
    CancellationToken cancellationToken) =>
{
    if (plan.Id != scenarioId)
        return Results.ValidationProblem(new Dictionary<string, string[]> { ["plan"] = ["Plan senaryo kimliği adresle eşleşmiyor."] });
    if (await store.TryGetInputAsync(scenarioId, cancellationToken) is null) return Results.NotFound();
    var errors = ManualPlanValidator.Validate(plan);
    if (errors.Count > 0) return Results.ValidationProblem(errors);

    var stopMap = plan.Stops.ToDictionary(s => s.Id, s => s.Location);
    var updatedRoutes = new List<RouteResult>();

    foreach (var route in plan.Routes)
    {
        if (string.IsNullOrEmpty(route.Geometry) || route.DistanceMeters == 0)
        {
            var vehicle = plan.Vehicles.FirstOrDefault(v => v.Id == route.VehicleId);
            var waypoints = new List<double[]>();

            if (vehicle?.Start is { Length: 2 })
                waypoints.Add(vehicle.Start);

            foreach (var stopId in route.StopIds)
            {
                if (stopMap.TryGetValue(stopId, out var loc) && loc is { Length: 2 })
                    waypoints.Add(loc);
            }

            if (plan.Workplace is { Length: 2 })
                waypoints.Add(plan.Workplace);

            if (waypoints.Count >= 2)
            {
                var osrmRes = await osrmClient.RecalculateRouteAsync(waypoints, cancellationToken);
                if (osrmRes.HasValue)
                {
                    updatedRoutes.Add(route with {
                        Geometry = osrmRes.Value.Geometry,
                        DistanceMeters = osrmRes.Value.DistanceMeters,
                        DurationSeconds = osrmRes.Value.DurationSeconds,
                        RestrictedAreasCrossed = [.. restrictedAreas.FindCrossings(osrmRes.Value.Geometry)],
                    });
                    continue;
                }
            }
        }
        updatedRoutes.Add(route with {
            RestrictedAreasCrossed = [.. restrictedAreas.FindCrossings(route.Geometry)],
        });
    }

    var savedPlan = plan with { Routes = updatedRoutes, UpdatedAt = DateTimeOffset.UtcNow };
    return await versions.SetActivePlanAsync(scenarioId, savedPlan, cancellationToken)
        ? Results.Ok(savedPlan)
        : Results.NotFound();
}).RequireAuthorization();

app.MapPost("/api/v1/scenarios/{scenarioId:guid}/full-reoptimize", async (
    Guid scenarioId,
    FullReoptimizeRequest request,
    ClaimsPrincipal principal,
    IScenarioStore store,
    IPlanVersionStore versions,
    ScenarioQueue queue,
    CancellationToken cancellationToken) =>
{
    if (request.Plan.Id != scenarioId)
        return Results.ValidationProblem(new Dictionary<string, string[]> { ["plan"] = ["Plan senaryo kimliği adresle eşleşmiyor."] });
    var planErrors = ManualPlanValidator.Validate(request.Plan);
    if (planErrors.Count > 0) return Results.ValidationProblem(planErrors);
    if (await store.TryGetInputAsync(scenarioId, cancellationToken) is null) return Results.NotFound();

    var input = new ScenarioInput
    {
        Name = request.Plan.Name,
        Direction = "morning_inbound",
        Workplace = request.Plan.Workplace,
        ArrivalDeadline = TimeOnly.FromTimeSpan(TimeSpan.FromSeconds(request.Plan.DeadlineSeconds)),
        Persons = request.Plan.Persons,
        Vehicles = request.Plan.Vehicles,
        ImportWarnings = request.Plan.Warnings
            .Where(warning => warning.StartsWith("Excel içe aktarımı:", StringComparison.Ordinal))
            .ToList(),
    };
    var inputErrors = ScenarioValidator.Validate(input);
    if (inputErrors.Count > 0) return Results.ValidationProblem(inputErrors);

    if (!string.IsNullOrWhiteSpace(request.SnapshotName))
    {
        var createdBy = principal.FindFirstValue(ClaimTypes.Email) ?? "unknown";
        await versions.SaveAsync(
            scenarioId, request.SnapshotName, "Tam yeniden optimizasyon öncesi snapshot",
            request.Plan, createdBy, cancellationToken);
    }
    if (!await store.ReplaceForFullOptimizationAsync(scenarioId, input, cancellationToken)) return Results.NotFound();
    await versions.ClearActivePlanAsync(scenarioId, cancellationToken);
    await queue.EnqueueAsync(new ScenarioJob(scenarioId), cancellationToken);

    return Results.Accepted(
        $"/api/v1/scenarios/{scenarioId}",
        new ScenarioAccepted(scenarioId, ScenarioStatus.Queued));
}).RequireAuthorization();

app.MapPost("/api/v1/scenarios/{scenarioId:guid}/versions", async (
    Guid scenarioId,
    SavePlanVersionRequest request,
    ClaimsPrincipal principal,
    IScenarioStore store,
    IPlanVersionStore versions,
    CancellationToken cancellationToken) =>
{
    if (string.IsNullOrWhiteSpace(request.Name))
        return Results.ValidationProblem(new Dictionary<string, string[]> { ["name"] = ["Versiyon adı zorunludur."] });
    if (request.Plan.Id != scenarioId)
        return Results.ValidationProblem(new Dictionary<string, string[]> { ["plan"] = ["Plan senaryo kimliği adresle eşleşmiyor."] });
    if (await store.TryGetInputAsync(scenarioId, cancellationToken) is null) return Results.NotFound();
    var vehicleErrors = ScenarioValidator.ValidateVehiclesOnly(request.Plan.Vehicles);
    if (vehicleErrors.Count > 0) return Results.ValidationProblem(vehicleErrors);
    if (request.Plan.Persons.Select(person => person.Id).Distinct(StringComparer.Ordinal).Count() != request.Plan.Persons.Count)
        return Results.ValidationProblem(new Dictionary<string, string[]> { ["persons"] = ["Personel kimlikleri benzersiz olmalıdır."] });

    var createdBy = principal.FindFirstValue(ClaimTypes.Email) ?? "unknown";
    return Results.Ok(await versions.SaveAsync(
        scenarioId, request.Name, request.Description, request.Plan, createdBy, cancellationToken));
}).RequireAuthorization();

app.MapGet("/api/v1/scenarios/{scenarioId:guid}/versions", async (
    Guid scenarioId,
    IPlanVersionStore versions,
    CancellationToken cancellationToken) => Results.Ok(await versions.ListAsync(scenarioId, cancellationToken)))
    .RequireAuthorization();

app.MapPost("/api/v1/scenarios/{scenarioId:guid}/versions/{versionId:guid}/activate", async (
    Guid scenarioId,
    Guid versionId,
    IPlanVersionStore versions,
    CancellationToken cancellationToken) =>
    await versions.ActivateAsync(scenarioId, versionId, cancellationToken) ? Results.NoContent() : Results.NotFound())
    .RequireAuthorization();

app.MapDelete("/api/v1/scenarios/{scenarioId:guid}/versions/{versionId:guid}", async (
    Guid scenarioId,
    Guid versionId,
    IPlanVersionStore versions,
    CancellationToken cancellationToken) =>
    await versions.DeleteAsync(scenarioId, versionId, cancellationToken) ? Results.NoContent() : Results.NotFound())
    .RequireAuthorization();

app.MapGet("/api/v1/scenarios/{scenarioId:guid}/export", async (
    Guid scenarioId,
    IScenarioStore store,
    IPlanVersionStore versions,
    CancellationToken cancellationToken) =>
{
    var plan = await versions.TryGetActivePlanAsync(scenarioId, cancellationToken)
        ?? await store.TryGetResultAsync(scenarioId, cancellationToken);
    if (plan is null) return Results.NotFound();
    if (plan.Status != ScenarioStatus.Completed) return Results.Conflict(new { message = "Dışa aktarmak için plan tamamlanmış olmalıdır." });
    return Results.File(
        PlanExport.BuildPackage(plan),
        "application/zip",
        $"{scenarioId}-servis-plani.zip");
}).RequireAuthorization();

app.MapGet("/api/v1/scenarios/{scenarioId:guid}/nearby-services", async (
    Guid scenarioId,
    string address,
    IScenarioStore store,
    IPlanVersionStore versions,
    IGeocodingService geocoding,
    CancellationToken cancellationToken) =>
{
    if (string.IsNullOrWhiteSpace(address))
        return Results.ValidationProblem(new Dictionary<string, string[]> { ["address"] = ["Adres zorunludur."] });
    var plan = await versions.TryGetActivePlanAsync(scenarioId, cancellationToken)
        ?? await store.TryGetResultAsync(scenarioId, cancellationToken);
    if (plan is null) return Results.NotFound();
    var location = await geocoding.GeocodeAsync(address.Trim(), cancellationToken);
    if (location is null)
        return Results.ValidationProblem(new Dictionary<string, string[]> { ["address"] = ["Adres için koordinat bulunamadı."] });

    var stopById = plan.Stops.ToDictionary(stop => stop.Id, StringComparer.Ordinal);
    var services = plan.Vehicles.Select(vehicle =>
    {
        var route = plan.Routes.FirstOrDefault(candidate => candidate.VehicleId == vehicle.Id);
        var candidates = (route?.StopIds ?? [])
            .Where(stopById.ContainsKey)
            .Select(id => (Id: (string?)id, Location: stopById[id].Location))
            .ToList();
        if (vehicle.Start is not null) candidates.Add((null, vehicle.Start));
        if (candidates.Count == 0) candidates.Add((null, plan.Workplace));
        var nearest = candidates
            .Select(candidate => (candidate.Id, Distance: HaversineMeters(
                location.Longitude, location.Latitude, candidate.Location[0], candidate.Location[1])))
            .OrderBy(candidate => candidate.Distance)
            .First();
        return new NearbyServiceResult(vehicle.Id, nearest.Distance, nearest.Id, route?.Load ?? 0, vehicle.EffectiveCapacity);
    }).OrderBy(service => service.DistanceMeters).ToList();

    return Results.Ok(new NearbyServicesResponse(
        address.Trim(), [location.Longitude, location.Latitude], services));
}).RequireAuthorization();

app.Run();

static async Task<PersonGeocodingResult> GeocodePersonsAsync(
    List<AddressImportRow> rows,
    IGeocodingService geocodingService,
    int maxConcurrency,
    CancellationToken cancellationToken)
{
    var persons = new PersonInput?[rows.Count];
    var skipped = new string?[rows.Count];
    var errors = new string?[rows.Count];
    using var gate = new SemaphoreSlim(Math.Clamp(maxConcurrency, 1, 10));

    await Task.WhenAll(rows.Select(async (row, index) =>
    {
        await gate.WaitAsync(cancellationToken);
        try
        {
            var result = await geocodingService.GeocodeAsync(row.Address, cancellationToken);
            if (result is null)
                skipped[index] = $"{row.RowNumber}. satır (id: {row.Id}).";
            else
                persons[index] = new PersonInput(row.Id, [result.Longitude, result.Latitude], row.Name);
        }
        catch (HttpRequestException exception)
        {
            errors[index] = $"{row.RowNumber}. satır geocoding hatası (id: {row.Id}): {exception.Message}";
        }
        catch (TaskCanceledException exception) when (!cancellationToken.IsCancellationRequested)
        {
            errors[index] = $"{row.RowNumber}. satır geocoding zaman aşımı (id: {row.Id}): {exception.Message}";
        }
        finally
        {
            gate.Release();
        }
    }));

    return new PersonGeocodingResult(
        persons.Where(person => person is not null).Select(person => person!).ToList(),
        skipped.Where(item => item is not null).Select(item => item!).ToList(),
        errors.Where(error => error is not null).Select(error => error!).ToList());
}

static double HaversineMeters(double lon1, double lat1, double lon2, double lat2)
{
    const double radius = 6_371_000;
    static double Radians(double value) => value * Math.PI / 180d;
    var dLat = Radians(lat2 - lat1);
    var dLon = Radians(lon2 - lon1);
    var a = Math.Pow(Math.Sin(dLat / 2), 2)
        + Math.Cos(Radians(lat1)) * Math.Cos(Radians(lat2)) * Math.Pow(Math.Sin(dLon / 2), 2);
    return radius * 2 * Math.Atan2(Math.Sqrt(a), Math.Sqrt(1 - a));
}

static async Task EnsureSchemaWithRetryAsync(WebApplication app)
{
    using var scope = app.Services.CreateScope();
    var store = scope.ServiceProvider.GetRequiredService<IScenarioStore>();
    var userStore = scope.ServiceProvider.GetRequiredService<IUserStore>();
    var versionStore = scope.ServiceProvider.GetRequiredService<IPlanVersionStore>();

    for (var attempt = 1; attempt <= 10; attempt++)
    {
        try
        {
            await store.EnsureSchemaAsync(CancellationToken.None);
            await userStore.EnsureSchemaAsync(CancellationToken.None);
            await versionStore.EnsureSchemaAsync(CancellationToken.None);
            await EnsureBootstrapAdminAsync(scope.ServiceProvider, app.Configuration);
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
    await userStore.EnsureSchemaAsync(CancellationToken.None);
    await versionStore.EnsureSchemaAsync(CancellationToken.None);
    await EnsureBootstrapAdminAsync(scope.ServiceProvider, app.Configuration);
}

static async Task EnsureBootstrapAdminAsync(IServiceProvider services, IConfiguration configuration)
{
    var email = configuration["BootstrapAdmin:Email"]?.Trim();
    var password = configuration["BootstrapAdmin:Password"]?.Trim();
    if (string.IsNullOrWhiteSpace(email)) email = "admin@servis.com";
    if (string.IsNullOrWhiteSpace(password)) password = "Admin123456!";

    var users = services.GetRequiredService<IUserStore>();
    var existingUser = await users.FindByEmailAsync(email, CancellationToken.None);

    var now = DateTimeOffset.UtcNow;
    var userId = existingUser?.Id ?? Guid.NewGuid();
    var user = new AppUser(
        userId, email, configuration["BootstrapAdmin:DisplayName"] ?? "Sistem Yöneticisi",
        string.Empty, UserRoles.Admin, UserStatuses.Approved, existingUser?.CreatedAt ?? now, now);
    var hasher = services.GetRequiredService<IPasswordHasher<AppUser>>();
    user = user with { PasswordHash = hasher.HashPassword(user, password) };
    await users.UpsertUserAsync(user, CancellationToken.None);
}

sealed record PersonGeocodingResult(
    List<PersonInput> Persons,
    List<string> Skipped,
    List<string> Errors);

public partial class Program;
