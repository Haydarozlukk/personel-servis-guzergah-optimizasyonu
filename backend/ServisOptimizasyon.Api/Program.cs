using System.Collections.Concurrent;

var builder = WebApplication.CreateBuilder(args);

builder.Services.AddHealthChecks();
builder.Services.AddCors(options => options.AddDefaultPolicy(policy => policy
    .AllowAnyOrigin()
    .AllowAnyHeader()
    .AllowAnyMethod()));
builder.Services.AddHttpClient<OptimizationClient>(client =>
    client.BaseAddress = new Uri(builder.Configuration["Services:OptimizationUrl"]
        ?? "http://optimization:8000"));
builder.Services.AddHttpClient<VroomClient>(client =>
    client.BaseAddress = new Uri(builder.Configuration["Services:VroomUrl"]
        ?? "http://vroom:3000"));
builder.Services.AddSingleton<ScenarioOrchestrator>();
builder.Services.AddSingleton<ConcurrentDictionary<Guid, ScenarioResult>>();

var app = builder.Build();

app.UseCors();
app.MapHealthChecks("/health");

app.MapPost("/api/v1/scenarios", async (
    ScenarioInput input,
    ScenarioOrchestrator orchestrator,
    ConcurrentDictionary<Guid, ScenarioResult> results,
    CancellationToken cancellationToken) =>
{
    var errors = ValidateScenario(input);
    if (errors.Count > 0)
        return Results.ValidationProblem(errors);

    var scenarioId = Guid.NewGuid();

    try
    {
        var result = await orchestrator.OptimizeAsync(scenarioId, input, cancellationToken);
        results[scenarioId] = result;
    }
    catch (Exception exception)
    {
        results[scenarioId] = new ScenarioResult(
            scenarioId,
            "failed",
            [],
            input.Persons.Select(person => person.Id).Order().ToList(),
            Error: exception.Message);
    }

    return Results.Accepted(
        $"/api/v1/scenarios/{scenarioId}",
        new ScenarioAccepted(scenarioId, "queued"));
});

app.MapGet("/api/v1/scenarios/{scenarioId:guid}", (
    Guid scenarioId,
    ConcurrentDictionary<Guid, ScenarioResult> results) =>
    results.TryGetValue(scenarioId, out var result)
        ? Results.Ok(result)
        : Results.NotFound(new { scenarioId, message = "Senaryo bulunamadı." }));

app.Run();

static Dictionary<string, string[]> ValidateScenario(ScenarioInput input)
{
    var errors = new Dictionary<string, string[]>();

    if (input.Direction != "morning_inbound")
        errors["direction"] = ["Yalnızca morning_inbound desteklenir."];
    if (input.Persons.Count == 0)
        errors["persons"] = ["En az bir personel girilmelidir."];
    if (input.Vehicles.Count == 0)
        errors["vehicles"] = ["En az bir araç girilmelidir."];
    if (input.Persons.Select(person => person.Id).Distinct(StringComparer.Ordinal).Count() != input.Persons.Count)
        errors["persons"] = ["Personel kimlikleri benzersiz olmalıdır."];
    if (input.Vehicles.Select(vehicle => vehicle.Id).Distinct(StringComparer.Ordinal).Count() != input.Vehicles.Count)
        errors["vehicles"] = ["Araç kimlikleri benzersiz olmalıdır."];
    if (input.Vehicles.Any(vehicle => vehicle.Capacity < 1))
        errors["vehicles"] = ["Araç kapasitesi en az bir olmalıdır."];
    if (!IsCoordinate(input.Workplace)
        || input.Persons.Any(person => !IsCoordinate(person.Location))
        || input.Vehicles.Any(vehicle => !IsCoordinate(vehicle.Start)))
        errors["location"] = ["Koordinatlar [boylam, enlem] sırasında ve geçerli aralıkta olmalıdır."];

    return errors;
}

static bool IsCoordinate(double[] coordinate) =>
    coordinate.Length == 2
    && coordinate[0] is >= -180 and <= 180
    && coordinate[1] is >= -90 and <= 90;

public partial class Program;
