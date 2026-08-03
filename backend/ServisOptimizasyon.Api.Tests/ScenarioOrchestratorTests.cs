using System.Net;
using System.Text;
using System.Text.Json;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using Xunit;

public class ScenarioOrchestratorTests
{
    private const string SingleStopResponse = """
        {
          "stops": [
            {
              "id": "stop-candidate-001",
              "location": [32.8597, 39.9334],
              "assignedPersonIds": ["person-001", "person-002"],
              "walkingDistancesMeters": { "person-001": 120.5, "person-002": 240.0 },
              "walkingDurationsSeconds": { "person-001": 90.0, "person-002": 180.0 },
              "demand": 2,
              "qualityScore": 1.0,
              "averageWalkingDistanceMeters": 180.25
            }
          ],
          "unassignedPersonIds": [],
          "unassignedPersons": [],
          "summary": {
            "stopCount": 1,
            "assignedPersonCount": 2,
            "unassignedPersonCount": 0,
            "averageWalkingDistanceMeters": 180.25,
            "maximumWalkingDistanceMeters": 240.0,
            "averageWalkingDurationSeconds": 135.0,
            "maximumWalkingDurationSeconds": 180.0,
            "matrixChunkCount": 1
          }
        }
        """;

    private static ScenarioInput Input(params VehicleInput[] vehicles) => new()
    {
        Name = "Ankara sabah",
        Direction = "morning_inbound",
        Workplace = [32.8541, 39.9208],
        ArrivalDeadline = new TimeOnly(8, 30),
        Persons =
        [
            new PersonInput("person-001", [32.8597, 39.9334]),
            new PersonInput("person-002", [32.8642, 39.9261]),
        ],
        Vehicles = vehicles.Length > 0
            ? [.. vehicles]
            : [new VehicleInput("vehicle-001", 16, [32.8597, 39.9334])],
    };

    private static (ScenarioOrchestrator Orchestrator, RecordingHandler Vroom) Build(
        string optimizationJson,
        string vroomJson)
    {
        var optimizationHandler = new RecordingHandler(optimizationJson);
        var vroomHandler = new RecordingHandler(vroomJson);

        var optimizationClient = new OptimizationClient(new HttpClient(optimizationHandler)
        {
            BaseAddress = new Uri("http://optimization:8000"),
        });
        var vroomClient = new VroomClient(new HttpClient(vroomHandler)
        {
            BaseAddress = new Uri("http://vroom:3000"),
        });

        var orchestrator = new ScenarioOrchestrator(
            optimizationClient,
            vroomClient,
            Options.Create(new OptimizationOptions()),
            NullLogger<ScenarioOrchestrator>.Instance);

        return (orchestrator, vroomHandler);
    }

    private static string VroomRouteResponse(int endArrival = 30000) => $$"""
        {
          "code": 0,
          "routes": [
            {
              "vehicle": 1,
              "distance": 12000,
              "duration": 1500,
              "pickup": [2],
              "geometry": "polyline-abc",
              "steps": [
                { "type": "start", "arrival": 28000 },
                { "type": "job", "job": 1, "arrival": 29000, "load": [2] },
                { "type": "end", "arrival": {{endArrival}} }
              ]
            }
          ],
          "unassigned": []
        }
        """;

    /// <summary>
    /// VROOM `time_window` alanını snake_case bekler. camelCase gönderilirse kısıt
    /// sessizce yok sayılır ve varış saati hiç uygulanmaz.
    /// </summary>
    [Fact]
    public async Task VroomRequestUsesSnakeCaseTimeWindow()
    {
        var (orchestrator, vroom) = Build(SingleStopResponse, VroomRouteResponse());

        await orchestrator.OptimizeAsync(Input(), CancellationToken.None);

        Assert.Contains("\"time_window\":[0,30600]", vroom.LastRequestBody);
        Assert.DoesNotContain("timeWindow", vroom.LastRequestBody);
    }

    [Fact]
    public async Task VroomJobCarriesBoardingServiceTime()
    {
        var (orchestrator, vroom) = Build(SingleStopResponse, VroomRouteResponse());

        await orchestrator.OptimizeAsync(Input(), CancellationToken.None);

        // Varsayılan: 30 sn sabit + kişi başı 10 sn, 2 kişi için 50 sn.
        Assert.Contains("\"service\":50", vroom.LastRequestBody);
        Assert.Contains("\"pickup\":[2]", vroom.LastRequestBody);
    }

    [Fact]
    public async Task StopsAndStepsAreReturnedForTheMap()
    {
        var (orchestrator, _) = Build(SingleStopResponse, VroomRouteResponse());

        var computation = await orchestrator.OptimizeAsync(Input(), CancellationToken.None);

        var stop = Assert.Single(computation.Stops);
        Assert.Equal("stop-candidate-001", stop.Id);
        Assert.Equal(new[] { 32.8597, 39.9334 }, stop.Location);
        Assert.Equal(120.5, stop.WalkingDistancesMeters["person-001"]);
        Assert.Equal(90.0, stop.WalkingDurationsSeconds["person-001"]);
        Assert.Equal(180.25, stop.AverageWalkingDistanceMeters);

        var route = Assert.Single(computation.Routes);
        Assert.Equal("vehicle-001", route.VehicleId);
        Assert.Equal(12000, route.DistanceMeters);
        Assert.Equal("polyline-abc", route.Geometry);
        Assert.Equal(new[] { "stop-candidate-001" }, route.StopIds);

        var step = Assert.Single(route.Steps);
        Assert.Equal("stop-candidate-001", step.StopId);
        Assert.Equal(29000, step.ArrivalSeconds);
        Assert.Equal(2, step.Load);
    }

    [Fact]
    public async Task ArrivalBeforeDeadlineIsReportedAsMet()
    {
        var (orchestrator, _) = Build(SingleStopResponse, VroomRouteResponse(endArrival: 30000));

        var computation = await orchestrator.OptimizeAsync(Input(), CancellationToken.None);

        Assert.True(computation.DeadlineMet);
        Assert.Equal(30000, computation.Routes[0].ArrivalSeconds);
        Assert.DoesNotContain("En az bir araç varış saatini aşıyor.", computation.Warnings);
    }

    [Fact]
    public async Task ArrivalAfterDeadlineIsReportedAsMissed()
    {
        var (orchestrator, _) = Build(SingleStopResponse, VroomRouteResponse(endArrival: 31000));

        var computation = await orchestrator.OptimizeAsync(Input(), CancellationToken.None);

        Assert.False(computation.DeadlineMet);
        Assert.False(computation.Routes[0].DeadlineMet);
        Assert.Contains("En az bir araç varış saatini aşıyor.", computation.Warnings);
    }

    [Fact]
    public async Task PeopleAtAnUnassignedStopBecomeUnassigned()
    {
        const string unassignedResponse = """
            {
              "code": 0,
              "routes": [],
              "unassigned": [{ "id": 1, "type": "job" }]
            }
            """;

        var (orchestrator, _) = Build(SingleStopResponse, unassignedResponse);

        var computation = await orchestrator.OptimizeAsync(Input(), CancellationToken.None);

        Assert.Equal(
            new[] { "person-001", "person-002" },
            computation.UnassignedPersons.Select(person => person.Id));
        // Durak üretiminde atanmışlardı; atanamama sebebi VROOM tarafındadır.
        Assert.All(
            computation.UnassignedPersons,
            person => Assert.Equal(UnassignedPersonResult.NotRouted, person.Reason));
    }

    /// <summary>
    /// Optimizasyon servisinin K6 ile ürettiği gerekçe, VROOM'un ürettiği
    /// <c>not_routed</c> gerekçesinin önünde tutulur.
    /// </summary>
    [Fact]
    public async Task StopGenerationReasonWinsOverRoutingReason()
    {
        const string withUnassignedResponse = """
            {
              "stops": [
                {
                  "id": "stop-candidate-001",
                  "location": [32.8597, 39.9334],
                  "assignedPersonIds": ["person-001"],
                  "walkingDistancesMeters": { "person-001": 120.5 },
                  "walkingDurationsSeconds": { "person-001": 90.0 },
                  "demand": 1,
                  "qualityScore": 0.5,
                  "averageWalkingDistanceMeters": 120.5
                }
              ],
              "unassignedPersonIds": ["person-002"],
              "unassignedPersons": [{ "id": "person-002", "reason": "no_candidate_within_limit" }],
              "summary": {
                "stopCount": 1,
                "assignedPersonCount": 1,
                "unassignedPersonCount": 1,
                "averageWalkingDistanceMeters": 120.5,
                "maximumWalkingDistanceMeters": 120.5,
                "averageWalkingDurationSeconds": 90.0,
                "maximumWalkingDurationSeconds": 90.0,
                "matrixChunkCount": 2
              }
            }
            """;

        const string allUnassignedResponse = """
            {
              "code": 0,
              "routes": [],
              "unassigned": [{ "id": 1, "type": "job" }]
            }
            """;

        var (orchestrator, _) = Build(withUnassignedResponse, allUnassignedResponse);

        var computation = await orchestrator.OptimizeAsync(Input(), CancellationToken.None);

        Assert.Equal(2, computation.UnassignedPersons.Count);
        Assert.Equal(
            "not_routed",
            computation.UnassignedPersons.Single(person => person.Id == "person-001").Reason);
        Assert.Equal(
            "no_candidate_within_limit",
            computation.UnassignedPersons.Single(person => person.Id == "person-002").Reason);
    }

    [Fact]
    public async Task StopGenerationSummaryIsCarriedIntoTheComputation()
    {
        var (orchestrator, _) = Build(SingleStopResponse, VroomRouteResponse());

        var computation = await orchestrator.OptimizeAsync(Input(), CancellationToken.None);

        Assert.NotNull(computation.StopGenerationSummary);
        Assert.Equal(1, computation.StopGenerationSummary.StopCount);
        Assert.Equal(2, computation.StopGenerationSummary.AssignedPersonCount);
        Assert.Equal(1, computation.StopGenerationSummary.MatrixChunkCount);
    }

    [Fact]
    public async Task VroomErrorCodeFailsTheScenario()
    {
        var (orchestrator, _) = Build(
            SingleStopResponse,
            """{ "code": 3, "error": "Invalid profile" }""");

        var exception = await Assert.ThrowsAsync<InvalidOperationException>(
            () => orchestrator.OptimizeAsync(Input(), CancellationToken.None));

        Assert.Contains("Invalid profile", exception.Message);
    }

    [Fact]
    public async Task StopDemandAboveLargestVehicleProducesAWarning()
    {
        // 2 kişilik durak, 1 kapasiteli tek araç: VROOM durağı tümüyle atanamamış sayar.
        const string unassignedResponse = """
            {
              "code": 0,
              "routes": [],
              "unassigned": [{ "id": 1, "type": "job" }]
            }
            """;

        var (orchestrator, _) = Build(SingleStopResponse, unassignedResponse);

        var computation = await orchestrator.OptimizeAsync(
            Input(new VehicleInput("vehicle-001", 1, [32.8597, 39.9334])),
            CancellationToken.None);

        Assert.Contains(computation.Warnings, warning => warning.Contains("talebi (2)"));
        Assert.Contains(computation.Warnings, warning => warning.Contains("Toplam araç kapasitesi"));
    }

    [Fact]
    public async Task MaxStopDemandIsSentToTheOptimizationService()
    {
        var optimizationHandler = new RecordingHandler(SingleStopResponse);
        var vroomHandler = new RecordingHandler(VroomRouteResponse());

        var orchestrator = new ScenarioOrchestrator(
            new OptimizationClient(new HttpClient(optimizationHandler)
            {
                BaseAddress = new Uri("http://optimization:8000"),
            }),
            new VroomClient(new HttpClient(vroomHandler) { BaseAddress = new Uri("http://vroom:3000") }),
            Options.Create(new OptimizationOptions()),
            NullLogger<ScenarioOrchestrator>.Instance);

        await orchestrator.OptimizeAsync(
            Input(
                new VehicleInput("vehicle-001", 16, [32.8597, 39.9334]),
                new VehicleInput("vehicle-002", 22, [32.8597, 39.9334])),
            CancellationToken.None);

        using var document = JsonDocument.Parse(optimizationHandler.LastRequestBody);
        Assert.Equal(22, document.RootElement.GetProperty("maxStopDemand").GetInt32());
        Assert.Equal(500, document.RootElement.GetProperty("maxWalkingDistanceMeters").GetInt32());
    }

    private sealed class RecordingHandler(string responseJson) : HttpMessageHandler
    {
        public string LastRequestBody { get; private set; } = string.Empty;

        protected override async Task<HttpResponseMessage> SendAsync(
            HttpRequestMessage request,
            CancellationToken cancellationToken)
        {
            if (request.Content is not null)
                LastRequestBody = await request.Content.ReadAsStringAsync(cancellationToken);

            return new HttpResponseMessage(HttpStatusCode.OK)
            {
                Content = new StringContent(responseJson, Encoding.UTF8, "application/json"),
            };
        }
    }
}
