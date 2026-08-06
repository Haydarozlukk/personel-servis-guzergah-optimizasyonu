using System.IO.Compression;
using Xunit;

public class ManualPlanTests
{
    [Fact]
    public void ValidatorRejectsPassengerInServiceAndUnassignedList()
    {
        var plan = CreatePlan(1) with
        {
            UnassignedPersonIds = ["p-1"],
            UnassignedPersons = [new UnassignedPersonResult("p-1", "manual_unassigned")],
        };

        var errors = ManualPlanValidator.Validate(plan);

        Assert.Contains("unassignedPersonIds", errors.Keys);
    }

    [Fact]
    public void ValidatorRejectsRouteAboveEffectiveCapacity()
    {
        var errors = ManualPlanValidator.Validate(CreatePlan(47));

        Assert.Contains(errors["routes"], message => message.Contains("47/46", StringComparison.Ordinal));
    }

    [Fact]
    public void ValidatorRejectsPassengerMissingFromBothAssignmentSets()
    {
        var plan = CreatePlan(1) with { Stops = [], Routes = [] };

        var errors = ManualPlanValidator.Validate(plan);

        Assert.Contains(errors["persons"], message => message.Contains("Her yolcu", StringComparison.Ordinal));
    }

    [Fact]
    public void ExportUsesManualStopOrderAndKeepsCoordinateChunksAtTwentyPoints()
    {
        var plan = CreatePlan(21);
        using var package = new MemoryStream(PlanExport.BuildPackage(plan));
        using var archive = new ZipArchive(package, ZipArchiveMode.Read);
        var coordinateEntry = Assert.Single(archive.Entries, entry => entry.Name.EndsWith("sirali-koordinatlar.txt"));
        using var reader = new StreamReader(coordinateEntry.Open());
        var parts = reader.ReadToEnd().Split("Parça ", StringSplitOptions.RemoveEmptyEntries);

        Assert.Equal(2, parts.Length);
        Assert.All(parts, part => Assert.InRange(
            part.Split('\n', StringSplitOptions.RemoveEmptyEntries).Length - 1,
            1,
            20));
        var kml = Assert.Single(archive.Entries, entry => entry.Name.EndsWith(".kml"));
        using var kmlReader = new StreamReader(kml.Open());
        Assert.Contains("32.801,39.901", kmlReader.ReadToEnd());
    }

    private static ScenarioResult CreatePlan(int stopCount)
    {
        var people = Enumerable.Range(1, stopCount)
            .Select(index => new PersonInput($"p-{index}", [32.8 + index / 1000d, 39.9 + index / 1000d], $"Yolcu {index}"))
            .ToList();
        var stops = people.Select((person, index) => new StopResult(
            $"s-{index + 1}", person.Location, [person.Id], new() { [person.Id] = 0 }, new() { [person.Id] = 0 },
            1, 1, 0)).ToList();
        var stopIds = stops.Select(stop => stop.Id).ToList();
        var route = new RouteResult("v-1", 0, 0, stopCount, "", stopIds,
            stopIds.Select((id, index) => new RouteStepResult(id, 0, index + 1)).ToList(), 0, true);
        var now = DateTimeOffset.UtcNow;
        return new ScenarioResult(
            Guid.NewGuid(), "Plan", ScenarioStatus.Completed, 30600, [32.9, 39.95], people,
            [new VehicleInput("v-1", 46)], stops, [route], [], [], true, [], null, null, now, now);
    }
}
