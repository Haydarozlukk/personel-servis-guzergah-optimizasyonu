using System.Net.Http.Json;

public sealed class OptimizationClient(HttpClient client)
{
    public async Task<StopGenerationResult> GenerateStopsAsync(
        List<PersonInput> persons,
        CancellationToken cancellationToken)
    {
        using var response = await client.PostAsJsonAsync(
            "/api/v1/stops/generate",
            new StopGenerationRequest(persons, 500),
            cancellationToken);
        response.EnsureSuccessStatusCode();

        return await response.Content.ReadFromJsonAsync<StopGenerationResult>(cancellationToken)
            ?? throw new InvalidOperationException("Optimizasyon servisi boş cevap döndürdü.");
    }
}

public sealed class VroomClient(HttpClient client)
{
    public async Task<VroomResponse> OptimizeAsync(
        VroomRequest request,
        CancellationToken cancellationToken)
    {
        using var response = await client.PostAsJsonAsync("/", request, cancellationToken);
        response.EnsureSuccessStatusCode();

        var result = await response.Content.ReadFromJsonAsync<VroomResponse>(cancellationToken)
            ?? throw new InvalidOperationException("VROOM boş cevap döndürdü.");

        if (result.Code != 0)
            throw new InvalidOperationException($"VROOM hatası: {result.Error ?? result.Code.ToString()}.");

        return result;
    }
}

public sealed class ScenarioOrchestrator(
    OptimizationClient optimizationClient,
    VroomClient vroomClient)
{
    public async Task<ScenarioResult> OptimizeAsync(
        Guid scenarioId,
        ScenarioInput input,
        CancellationToken cancellationToken)
    {
        var stopResult = await optimizationClient.GenerateStopsAsync(
            input.Persons,
            cancellationToken);

        var jobToStop = stopResult.Stops
            .Select((stop, index) => (JobId: index + 1, Stop: stop))
            .ToDictionary(item => item.JobId, item => item.Stop);
        var vehicleByVroomId = input.Vehicles
            .Select((vehicle, index) => (VroomId: index + 1, Vehicle: vehicle))
            .ToDictionary(item => item.VroomId, item => item.Vehicle);
        var deadlineSeconds = (int)input.ArrivalDeadline.ToTimeSpan().TotalSeconds;

        var request = new VroomRequest(
            Jobs: jobToStop.Select(item => new VroomJob(
                item.Key,
                item.Value.Id,
                item.Value.Location,
                [item.Value.Demand])).ToList(),
            Vehicles: vehicleByVroomId.Select(item => new VroomVehicle(
                item.Key,
                item.Value.Id,
                "car",
                item.Value.Start,
                input.Workplace,
                [item.Value.Capacity],
                [0, deadlineSeconds])).ToList(),
            Options: new VroomOptions(true));

        var vroomResult = await vroomClient.OptimizeAsync(request, cancellationToken);
        var unassignedStopIds = vroomResult.Unassigned.Select(item => item.Id).ToHashSet();
        var unassignedPersonIds = stopResult.UnassignedPersonIds
            .Concat(unassignedStopIds.SelectMany(jobId => jobToStop[jobId].AssignedPersonIds))
            .Distinct(StringComparer.Ordinal)
            .Order()
            .ToList();

        var routes = vroomResult.Routes.Select(route =>
        {
            var vehicle = vehicleByVroomId[route.Vehicle];
            var load = route.Pickup.FirstOrDefault();
            if (load > vehicle.Capacity)
                throw new InvalidOperationException(
                    $"{vehicle.Id} kapasitesi aşıldı: {load}/{vehicle.Capacity}.");

            var stopIds = route.Steps
                .Where(step => step.Type == "job" && step.Job.HasValue)
                .Select(step => jobToStop[step.Job!.Value].Id)
                .ToList();

            return new RouteResult(
                vehicle.Id,
                route.Distance,
                route.Duration,
                load,
                route.Geometry ?? string.Empty,
                stopIds);
        }).ToList();

        return new ScenarioResult(
            scenarioId,
            "completed",
            routes,
            unassignedPersonIds);
    }
}
