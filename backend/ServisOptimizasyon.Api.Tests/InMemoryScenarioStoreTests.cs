using Xunit;

public class InMemoryScenarioStoreTests
{
    private static ScenarioInput Input() => new()
    {
        Name = "Ankara sabah",
        Direction = "morning_inbound",
        Workplace = [32.8541, 39.9208],
        ArrivalDeadline = new TimeOnly(8, 30),
        Persons = [new PersonInput("person-001", [32.8597, 39.9334])],
        Vehicles = [new VehicleInput("vehicle-001", 16, [32.8597, 39.9334])],
    };

    private static ScenarioComputation Computation() => new(
        Stops:
        [
            new StopResult(
                "stop-candidate-001",
                [32.8597, 39.9334],
                ["person-001"],
                new Dictionary<string, double> { ["person-001"] = 120.5 },
                new Dictionary<string, double> { ["person-001"] = 90.0 },
                1,
                1.0,
                120.5),
        ],
        Routes:
        [
            new RouteResult(
                "vehicle-001",
                12000,
                1500,
                1,
                "polyline",
                ["stop-candidate-001"],
                [new RouteStepResult("stop-candidate-001", 29000, 1)],
                30000,
                true),
        ],
        UnassignedPersons: [new UnassignedPersonResult("person-009", "no_candidate_within_limit")],
        DeadlineMet: true,
        Warnings: [],
        StopGenerationSummary: new StopGenerationSummary(
            StopCount: 1,
            AssignedPersonCount: 1,
            UnassignedPersonCount: 1,
            AverageWalkingDistanceMeters: 120.5,
            MaximumWalkingDistanceMeters: 120.5,
            AverageWalkingDurationSeconds: 90.0,
            MaximumWalkingDurationSeconds: 90.0,
            MatrixChunkCount: 3));

    [Fact]
    public async Task NewScenarioStartsQueuedWithNoResult()
    {
        var store = new InMemoryScenarioStore();
        var scenarioId = Guid.NewGuid();

        await store.CreateAsync(scenarioId, Input(), CancellationToken.None);
        var result = await store.TryGetResultAsync(scenarioId, CancellationToken.None);

        Assert.NotNull(result);
        Assert.Equal(ScenarioStatus.Queued, result.Status);
        Assert.Equal(30600, result.DeadlineSeconds);
        Assert.Empty(result.Stops);
        Assert.Empty(result.Routes);
        Assert.Null(result.DeadlineMet);
    }

    [Fact]
    public async Task UnknownScenarioReturnsNull()
    {
        var store = new InMemoryScenarioStore();

        Assert.Null(await store.TryGetResultAsync(Guid.NewGuid(), CancellationToken.None));
    }

    [Fact]
    public async Task SavedComputationIsReadBack()
    {
        var store = new InMemoryScenarioStore();
        var scenarioId = Guid.NewGuid();

        await store.CreateAsync(scenarioId, Input(), CancellationToken.None);
        await store.SaveComputationAsync(scenarioId, Computation(), CancellationToken.None);

        var result = await store.TryGetResultAsync(scenarioId, CancellationToken.None);

        Assert.NotNull(result);
        Assert.Equal(ScenarioStatus.Completed, result.Status);

        var stop = Assert.Single(result.Stops);
        Assert.Equal("stop-candidate-001", stop.Id);
        Assert.Equal(90.0, stop.WalkingDurationsSeconds["person-001"]);
        Assert.Equal(120.5, stop.AverageWalkingDistanceMeters);

        Assert.Equal(30000, Assert.Single(result.Routes).ArrivalSeconds);
        Assert.True(result.DeadlineMet);

        var unassigned = Assert.Single(result.UnassignedPersons);
        Assert.Equal("person-009", unassigned.Id);
        Assert.Equal("no_candidate_within_limit", unassigned.Reason);
        // Geriye dönük uyumluluk: kimlik listesi de doldurulur.
        Assert.Equal(new[] { "person-009" }, result.UnassignedPersonIds);

        Assert.NotNull(result.StopGenerationSummary);
        Assert.Equal(3, result.StopGenerationSummary.MatrixChunkCount);
    }

    /// <summary>
    /// Yeniden rotalamada durak üretimi çalışmaz; özet null gelir ve kayıtlı
    /// değer korunmalıdır.
    /// </summary>
    [Fact]
    public async Task ReroutingKeepsTheStoredStopGenerationSummary()
    {
        var store = new InMemoryScenarioStore();
        var scenarioId = Guid.NewGuid();

        await store.CreateAsync(scenarioId, Input(), CancellationToken.None);
        await store.SaveComputationAsync(scenarioId, Computation(), CancellationToken.None);
        await store.SaveComputationAsync(
            scenarioId,
            Computation() with { StopGenerationSummary = null },
            CancellationToken.None);

        var result = await store.TryGetResultAsync(scenarioId, CancellationToken.None);

        Assert.NotNull(result!.StopGenerationSummary);
        Assert.Equal(3, result.StopGenerationSummary.MatrixChunkCount);
    }

    [Fact]
    public async Task FailedStatusKeepsTheErrorMessage()
    {
        var store = new InMemoryScenarioStore();
        var scenarioId = Guid.NewGuid();

        await store.CreateAsync(scenarioId, Input(), CancellationToken.None);
        await store.SetStatusAsync(scenarioId, ScenarioStatus.Failed, "VROOM hatası", CancellationToken.None);

        var result = await store.TryGetResultAsync(scenarioId, CancellationToken.None);

        Assert.Equal(ScenarioStatus.Failed, result!.Status);
        Assert.Equal("VROOM hatası", result.Error);
    }

    [Fact]
    public async Task ReoptimizeIsRejectedBeforeAnyStopExists()
    {
        var store = new InMemoryScenarioStore();
        var scenarioId = Guid.NewGuid();

        await store.CreateAsync(scenarioId, Input(), CancellationToken.None);

        Assert.False(await store.PrepareReoptimizeAsync(scenarioId, null, CancellationToken.None));
    }

    [Fact]
    public async Task ReoptimizeKeepsStopsAndReplacesVehicles()
    {
        var store = new InMemoryScenarioStore();
        var scenarioId = Guid.NewGuid();

        await store.CreateAsync(scenarioId, Input(), CancellationToken.None);
        await store.SaveComputationAsync(scenarioId, Computation(), CancellationToken.None);

        var replaced = await store.PrepareReoptimizeAsync(
            scenarioId,
            [new VehicleInput("vehicle-009", 8, [32.8100, 39.9700])],
            CancellationToken.None);

        Assert.True(replaced);

        var input = await store.TryGetInputAsync(scenarioId, CancellationToken.None);
        Assert.Equal("vehicle-009", Assert.Single(input!.Vehicles).Id);

        var stops = await store.TryGetStopsAsync(scenarioId, CancellationToken.None);
        Assert.Equal("stop-candidate-001", Assert.Single(stops!).Id);

        var result = await store.TryGetResultAsync(scenarioId, CancellationToken.None);
        Assert.Equal(ScenarioStatus.Queued, result!.Status);
        Assert.Empty(result.Routes);
    }
}
