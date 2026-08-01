var builder = WebApplication.CreateBuilder(args);

builder.Services.AddOpenApi();
builder.Services.AddHealthChecks();
builder.Services.AddCors(options => options.AddDefaultPolicy(policy => policy
    .AllowAnyOrigin()
    .AllowAnyHeader()
    .AllowAnyMethod()));

var app = builder.Build();

app.UseCors();
app.MapOpenApi();
app.MapHealthChecks("/health");
app.MapPost("/api/v1/scenarios", (ScenarioInput input) =>
{
    var errors = new Dictionary<string, string[]>();

    if (input.Persons.Count == 0)
        errors["persons"] = ["En az bir personel girilmelidir."];
    if (input.Vehicles.Count == 0)
        errors["vehicles"] = ["En az bir araç girilmelidir."];
    if (input.Persons.Select(person => person.Id).Distinct(StringComparer.Ordinal).Count() != input.Persons.Count)
        errors["persons"] = ["Personel kimlikleri benzersiz olmalıdır."];
    if (input.Vehicles.Any(vehicle => vehicle.Capacity < 1))
        errors["vehicles"] = ["Araç kapasitesi en az bir olmalıdır."];

    if (errors.Count > 0)
        return Results.ValidationProblem(errors);

    var scenarioId = Guid.NewGuid();
    return Results.Accepted($"/api/v1/scenarios/{scenarioId}", new ScenarioAccepted(scenarioId, "queued"));
});
app.MapGet("/api/v1/scenarios/{scenarioId:guid}", (Guid scenarioId) =>
    Results.NotFound(new { scenarioId, message = "Senaryo henüz kalıcı depoya bağlanmadı." }));

app.Run();

public sealed record ScenarioInput(
    string Name,
    string Direction,
    double[] Workplace,
    TimeOnly ArrivalDeadline,
    List<PersonInput> Persons,
    List<VehicleInput> Vehicles);

public sealed record PersonInput(string Id, double[] Location);
public sealed record VehicleInput(string Id, int Capacity, double[] Start);
public sealed record ScenarioAccepted(Guid Id, string Status);

public partial class Program;
