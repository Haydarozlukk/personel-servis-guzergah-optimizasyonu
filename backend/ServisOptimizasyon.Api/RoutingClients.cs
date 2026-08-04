using System.Net.Http.Json;
using Microsoft.Extensions.Options;

public sealed class OptimizationOptions
{
    /// <summary>PoC kabulü: 500 m gerçek yürüme mesafesi (docs/kararlar.md).</summary>
    public int MaxWalkingDistanceMeters { get; set; } = 500;

    /// <summary>Durakta kapı açma/kapama için sabit süre (saniye).</summary>
    public int StopBaseServiceSeconds { get; set; } = 30;

    /// <summary>Durakta kişi başına biniş süresi (saniye).</summary>
    public int BoardingSecondsPerPerson { get; set; } = 10;
}

public sealed class OptimizationClient(HttpClient client)
{
    public async Task<StopGenerationResult> GenerateStopsAsync(
        List<PersonInput> persons,
        int maxWalkingDistanceMeters,
        int? maxStopDemand,
        CancellationToken cancellationToken)
    {
        using var response = await client.PostAsJsonAsync(
            "/api/v1/stops/generate",
            new StopGenerationRequest(persons, maxWalkingDistanceMeters, maxStopDemand),
            cancellationToken);

        if (!response.IsSuccessStatusCode)
        {
            var body = await response.Content.ReadAsStringAsync(cancellationToken);
            throw new InvalidOperationException(
                $"Optimizasyon servisi {(int)response.StatusCode} döndürdü: {Truncate(body)}");
        }

        return await response.Content.ReadFromJsonAsync<StopGenerationResult>(cancellationToken)
            ?? throw new InvalidOperationException("Optimizasyon servisi boş cevap döndürdü.");
    }

    private static string Truncate(string value) =>
        value.Length <= 500 ? value : value[..500];
}

public sealed class VroomClient(HttpClient client)
{
    public async Task<VroomResponse> OptimizeAsync(
        VroomRequest request,
        CancellationToken cancellationToken)
    {
        using var response = await client.PostAsJsonAsync("/", request, cancellationToken);

        if (!response.IsSuccessStatusCode)
        {
            var body = await response.Content.ReadAsStringAsync(cancellationToken);
            throw new InvalidOperationException(
                $"VROOM {(int)response.StatusCode} döndürdü: {Truncate(body)}");
        }

        var result = await response.Content.ReadFromJsonAsync<VroomResponse>(cancellationToken)
            ?? throw new InvalidOperationException("VROOM boş cevap döndürdü.");

        if (result.Code != 0)
            throw new InvalidOperationException($"VROOM hatası: {result.Error ?? result.Code.ToString()}.");

        return result;
    }

    private static string Truncate(string value) =>
        value.Length <= 500 ? value : value[..500];
}

public sealed class ScenarioOrchestrator(
    OptimizationClient optimizationClient,
    VroomClient vroomClient,
    IOptions<OptimizationOptions> options,
    ILogger<ScenarioOrchestrator> logger)
{
    private readonly OptimizationOptions _options = options.Value;

    /// <summary>Durak üretimi ve rotalama; senaryonun ilk çalıştırması.</summary>
    public async Task<ScenarioComputation> OptimizeAsync(
        ScenarioInput input,
        CancellationToken cancellationToken)
    {
        // Bir durağın talebi filodaki her araç tarafından taşınabilir olmalıdır.
        // En büyük kapasite kullanılırsa küçük araçlar büyük durakları alamaz ve
        // yeterli toplam kapasite olmasına rağmen VROOM bu araçları boş bırakır.
        var maxStopDemand = input.Vehicles.Min(vehicle => vehicle.Capacity);

        logger.LogInformation(
            "Durak üretimi başlıyor: {PersonCount} personel, maxStopDemand={MaxStopDemand} (minimum araç kapasitesi).",
            input.Persons.Count,
            maxStopDemand);

        var stopResult = await optimizationClient.GenerateStopsAsync(
            input.Persons,
            _options.MaxWalkingDistanceMeters,
            maxStopDemand,
            cancellationToken);

        var stops = stopResult.Stops
            .Select(stop => new StopResult(
                stop.Id,
                stop.Location,
                stop.AssignedPersonIds,
                stop.WalkingDistancesMeters,
                stop.WalkingDurationsSeconds ?? [],
                stop.Demand,
                stop.QualityScore,
                stop.AverageWalkingDistanceMeters))
            .ToList();

        // Optimizasyon servisi gerekçe listesini K6 ile döndürüyor; eski sürümle
        // konuşulursa kimlik listesinden gerekçesiz kayıt üretilir.
        var previouslyUnassigned = stopResult.UnassignedPersons is { Count: > 0 }
            ? stopResult.UnassignedPersons
                .Select(person => new UnassignedPersonResult(person.Id, person.Reason))
                .ToList()
            : stopResult.UnassignedPersonIds
                .Select(personId => new UnassignedPersonResult(personId, "no_candidate_within_limit"))
                .ToList();

        logger.LogInformation(
            "Durak üretimi tamamlandı: {StopCount} durak, {ChunkCount} OSRM matris parçası.",
            stopResult.Summary?.StopCount ?? stops.Count,
            stopResult.Summary?.MatrixChunkCount ?? 0);

        return await RouteAsync(
            input,
            stops,
            previouslyUnassigned,
            stopResult.Summary,
            cancellationToken);
    }

    /// <summary>Kayıtlı duraklarla yalnızca rotalama; yeniden optimize akışı.</summary>
    public async Task<ScenarioComputation> RouteAsync(
        ScenarioInput input,
        List<StopResult> stops,
        List<UnassignedPersonResult> previouslyUnassignedPersons,
        StopGenerationSummary? stopGenerationSummary,
        CancellationToken cancellationToken)
    {
        var warnings = new List<string>();
        var maxCapacity = input.Vehicles.Max(vehicle => vehicle.Capacity);
        var totalCapacity = input.Vehicles.Sum(vehicle => vehicle.Capacity);

        if (totalCapacity < input.Persons.Count)
            warnings.Add(
                $"Toplam araç kapasitesi ({totalCapacity}) personel sayısından ({input.Persons.Count}) az; "
                + "bir kısım personel atanamayacak.");

        foreach (var stop in stops.Where(stop => stop.Demand > maxCapacity))
            warnings.Add(
                $"{stop.Id} durağının talebi ({stop.Demand}) en büyük araç kapasitesini ({maxCapacity}) aşıyor; "
                + "VROOM bu durağı tümüyle atanamamış sayacaktır.");

        var jobToStop = stops
            .Select((stop, index) => (JobId: index + 1, Stop: stop))
            .ToDictionary(item => item.JobId, item => item.Stop);
        var vehicleByVroomId = input.Vehicles
            .Select((vehicle, index) => (VroomId: index + 1, Vehicle: vehicle))
            .ToDictionary(item => item.VroomId, item => item.Vehicle);
        var deadlineSeconds = input.DeadlineSeconds;

        var request = new VroomRequest(
            Jobs: stops.Select((stop, index) => new VroomJob(
                index + 1,
                stop.Id,
                stop.Location,
                [stop.Demand],
                ServiceSecondsFor(stop.Demand))).ToList(),
            Vehicles: input.Vehicles.Select((vehicle, index) => new VroomVehicle(
                index + 1,
                vehicle.Id,
                "car",
                vehicle.Start,
                input.Workplace,
                [vehicle.Capacity],
                [0, deadlineSeconds])).ToList(),
            Options: new VroomOptions(true));

        var vroomResult = await vroomClient.OptimizeAsync(request, cancellationToken);

        List<VroomUnassigned> vroomUnassigned = vroomResult.Unassigned ?? [];
        List<VroomRoute> vroomRoutes = vroomResult.Routes ?? [];

        var unassignedStopJobIds = vroomUnassigned
            .Where(item => item.Type == "job")
            .Select(item => item.Id)
            .ToHashSet();
        var notRouted = unassignedStopJobIds
            .Where(jobToStop.ContainsKey)
            .SelectMany(jobId => jobToStop[jobId].AssignedPersonIds)
            .Select(personId => new UnassignedPersonResult(personId, UnassignedPersonResult.NotRouted));

        // Durak üretiminden gelen gerekçe daha bilgilendiricidir; aynı kişi iki
        // listede de varsa üretim gerekçesi korunur.
        var unassignedPersons = previouslyUnassignedPersons
            .Concat(notRouted)
            .GroupBy(person => person.Id, StringComparer.Ordinal)
            .Select(group => group.First())
            .OrderBy(person => person.Id, StringComparer.Ordinal)
            .ToList();

        var routes = vroomRoutes.Select(route =>
        {
            var vehicle = vehicleByVroomId[route.Vehicle];
            var load = route.Pickup?.FirstOrDefault() ?? 0;

            if (load > vehicle.Capacity)
                throw new InvalidOperationException(
                    $"{vehicle.Id} kapasitesi aşıldı: {load}/{vehicle.Capacity}.");

            List<VroomStep> steps = route.Steps ?? [];

            var stopSteps = steps
                .Where(step => step.Type == "job" && step.Job.HasValue && jobToStop.ContainsKey(step.Job.Value))
                .Select(step => new RouteStepResult(
                    jobToStop[step.Job!.Value].Id,
                    step.Arrival ?? 0,
                    step.Load?.FirstOrDefault() ?? 0))
                .ToList();

            var arrivalSeconds = steps.LastOrDefault(step => step.Type == "end")?.Arrival
                ?? steps.LastOrDefault()?.Arrival
                ?? 0;

            return new RouteResult(
                vehicle.Id,
                route.Distance,
                route.Duration,
                load,
                route.Geometry ?? string.Empty,
                stopSteps.Select(step => step.StopId).ToList(),
                stopSteps,
                arrivalSeconds,
                arrivalSeconds <= deadlineSeconds);
        }).ToList();

        var deadlineMet = routes.All(route => route.DeadlineMet);

        if (!deadlineMet)
            warnings.Add("En az bir araç varış saatini aşıyor.");

        logger.LogInformation(
            "Rotalama tamamlandı: {RouteCount} rota, {UnassignedCount} atanamayan personel.",
            routes.Count,
            unassignedPersons.Count);

        return new ScenarioComputation(
            stops,
            routes,
            unassignedPersons,
            deadlineMet,
            warnings,
            stopGenerationSummary);
    }

    private int ServiceSecondsFor(int demand) =>
        _options.StopBaseServiceSeconds + (_options.BoardingSecondsPerPerson * demand);
}
