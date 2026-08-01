var builder = WebApplication.CreateBuilder(args);

builder.Services.AddOpenApi();
builder.Services.AddHealthChecks();

var app = builder.Build();

app.MapOpenApi();
app.MapHealthChecks("/health");
app.MapGet("/api/v1/scenarios/{scenarioId:guid}", (Guid scenarioId) =>
    Results.NotFound(new { scenarioId, message = "Senaryo henüz kalıcı depoya bağlanmadı." }));

app.Run();

public partial class Program;
