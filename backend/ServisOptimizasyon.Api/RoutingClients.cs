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

    /// <summary>
    /// Araç başına ortalama durak sayısına uygulanacak üst sınır çarpanı.
    /// 1.25, rotaları dengelerken kapasite ve zaman kısıtları için pay bırakır.
    /// </summary>
    public double MaxRouteStopFactor { get; set; } = 1.25;

    /// <summary>
    /// Tek bir aracın rotasının sürebileceği azami süre (saniye). Varış saati
    /// çok geniş bir pencere bıraktığı için (ör. 08:30'a kadar) VROOM tek
    /// başına rotayı kısaltmaya çalışmaz; bu sınır aşılırsa VROOM durağı
    /// başka bir araca kaydırmak zorunda kalır. Varsayılan 60 dakika.
    /// </summary>
    public int MaxRouteDurationSeconds { get; set; } = 2700;

    /// <summary>
    /// Tek bir aracın rotası için önerilen azami mesafe (metre). VROOM'da
    /// yerli bir mesafe kısıtı olmadığından bu doğrudan uygulanmaz; aşıldığında
    /// yalnızca uyarı üretilir (bkz. ScenarioOrchestrator.RouteAsync).
    /// </summary>
    public int MaxRouteDistanceMeters { get; set; } = 30_000;
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

public sealed record OsrmRouteResponse(
    string Code,
    List<OsrmRouteItem>? Routes);

public sealed record OsrmRouteItem(
    double Distance,
    double Duration,
    string Geometry);

public sealed class OsrmCarClient(HttpClient client)
{
    public async Task<(string Geometry, int DistanceMeters, int DurationSeconds)?> RecalculateRouteAsync(
        List<double[]> waypoints,
        CancellationToken cancellationToken)
    {
        if (waypoints.Count < 2) return null;

        var coords = string.Join(";", waypoints.Select(w => $"{w[0].ToString(System.Globalization.CultureInfo.InvariantCulture)},{w[1].ToString(System.Globalization.CultureInfo.InvariantCulture)}"));
        var url = $"/route/v1/driving/{coords}?overview=full&geometries=polyline";

        try
        {
            using var response = await client.GetAsync(url, cancellationToken);
            if (!response.IsSuccessStatusCode) return null;

            var result = await response.Content.ReadFromJsonAsync<OsrmRouteResponse>(cancellationToken);
            if (result is null || result.Code != "Ok" || result.Routes is null || result.Routes.Count == 0) return null;

            var item = result.Routes[0];
            return (item.Geometry, (int)Math.Round(item.Distance), (int)Math.Round(item.Duration));
        }
        catch
        {
            return null;
        }
    }
}

public sealed class ScenarioOrchestrator(
    OptimizationClient optimizationClient,
    VroomClient vroomClient,
    RestrictedAreaChecker restrictedAreas,
    IGeocodingService geocodingService,
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
        var maxStopDemand = input.Vehicles.Min(vehicle => vehicle.EffectiveCapacity);

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
        var warnings = new List<string>(input.ImportWarnings);
        var maxCapacity = input.Vehicles.Max(vehicle => vehicle.EffectiveCapacity);
        var totalCapacity = input.Vehicles.Sum(vehicle => vehicle.EffectiveCapacity);

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
        var activeVehicleCount = Math.Min(input.Vehicles.Count, Math.Max(1, stops.Count));
        var averageStopsPerActiveVehicle = stops.Count / (double)activeVehicleCount;
        var maxTasksPerVehicle = stops.Count == 0
            ? 1
            : Math.Min(
                stops.Count,
                Math.Max(1, (int)Math.Ceiling(averageStopsPerActiveVehicle * _options.MaxRouteStopFactor)));

        // Azami rota süresi filo sabit olsa da uygulanır: asıl dengeleyici bu
        // sınırdır (sık bölgede araç daha çok kişi toplar, seyrek bölgede daha
        // az) — kaldırılırsa kapasite geniş olduğu için VROOM yine en ucuz
        // çözüme (birkaç araca yığma) döner.
        var routeWindowEnd = Math.Min(deadlineSeconds, _options.MaxRouteDurationSeconds);
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
                null,
                input.Workplace,
                [vehicle.EffectiveCapacity],
                [0, routeWindowEnd],
                maxTasksPerVehicle)).ToList(),
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

            if (load > vehicle.EffectiveCapacity)
                throw new InvalidOperationException(
                    $"{vehicle.Id} etkin kapasitesi aşıldı: {load}/{vehicle.EffectiveCapacity}.");

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
                arrivalSeconds <= deadlineSeconds)
            {
                RestrictedAreasCrossed = [.. restrictedAreas.FindCrossings(route.Geometry)],
            };
        }).ToList();

        var deadlineMet = routes.All(route => route.DeadlineMet);

        if (!deadlineMet)
            warnings.Add("En az bir araç varış saatini aşıyor.");

        foreach (var route in routes.Where(route => route.RestrictedAreasCrossed.Count > 0))
            warnings.Add(
                $"{route.VehicleId} güzergâhı halka kapalı alandan geçiyor: "
                + $"{string.Join(", ", route.RestrictedAreasCrossed)}.");

        foreach (var route in routes.Where(route => route.DistanceMeters > _options.MaxRouteDistanceMeters))
            warnings.Add(
                $"{route.VehicleId} rotası {route.DistanceMeters / 1000.0:0.0} km ile önerilen azami mesafeyi "
                + $"({_options.MaxRouteDistanceMeters / 1000.0:0} km) aşıyor; bu rotayı ek bir araçla bölmeyi düşünün.");

        logger.LogInformation(
            "Rotalama tamamlandı: {RouteCount} rota, {UnassignedCount} atanamayan personel.",
            routes.Count,
            unassignedPersons.Count);

        // VROOM'un rotalayamadığı (unassigned) kişiler duraktan da düşürülmeli;
        // aksi halde durak "yolcusu var ama hiçbir rotada değil" durumunda kalır
        // ve ManualPlanValidator (bkz. manuel taşıma sonrası kayıt) reddeder.
        var unassignedPersonIdSet = unassignedPersons
            .Select(person => person.Id)
            .ToHashSet(StringComparer.Ordinal);
        var reconciledStops = stops
            .Select(stop =>
            {
                if (!stop.AssignedPersonIds.Any(unassignedPersonIdSet.Contains))
                    return stop;

                var remainingPersonIds = stop.AssignedPersonIds
                    .Where(personId => !unassignedPersonIdSet.Contains(personId))
                    .ToList();
                return stop with
                {
                    AssignedPersonIds = remainingPersonIds,
                    WalkingDistancesMeters = stop.WalkingDistancesMeters
                        .Where(entry => !unassignedPersonIdSet.Contains(entry.Key))
                        .ToDictionary(entry => entry.Key, entry => entry.Value),
                    WalkingDurationsSeconds = stop.WalkingDurationsSeconds
                        .Where(entry => !unassignedPersonIdSet.Contains(entry.Key))
                        .ToDictionary(entry => entry.Key, entry => entry.Value),
                    Demand = remainingPersonIds.Count,
                };
            })
            .Where(stop => stop.AssignedPersonIds.Count > 0)
            .ToList();

        var suggestedVehicleLabels = await BuildSuggestedVehicleLabelsAsync(
            input.Vehicles, routes, stops, cancellationToken);

        return new ScenarioComputation(
            reconciledStops,
            routes,
            unassignedPersons,
            deadlineMet,
            warnings,
            stopGenerationSummary)
        {
            SuggestedVehicleLabels = suggestedVehicleLabels,
        };
    }

    /// <summary>
    /// Kullanıcı henüz elle isim vermemiş, rotası olan her araç için son durağın
    /// (işyerine en yakın, dolayısıyla o rotayı temsil eden) ilçesinden bir isim
    /// önerisi üretir. Reverse geocoding başarısız olan araçlar önerisiz kalır;
    /// bu bir hata değildir, isimlendirme optimizasyonun kritik yolunda değildir.
    /// </summary>
    private async Task<Dictionary<string, string>> BuildSuggestedVehicleLabelsAsync(
        List<VehicleInput> vehicles,
        List<RouteResult> routes,
        List<StopResult> stops,
        CancellationToken cancellationToken)
    {
        var stopLocations = stops.ToDictionary(stop => stop.Id, stop => stop.Location);
        var labeledVehicleIds = vehicles
            .Where(vehicle => !string.IsNullOrWhiteSpace(vehicle.Label))
            .Select(vehicle => vehicle.Id)
            .ToHashSet(StringComparer.Ordinal);

        var candidates = routes
            .Where(route => route.StopIds.Count > 0 && !labeledVehicleIds.Contains(route.VehicleId))
            .Select(route => (route.VehicleId, Location: stopLocations.GetValueOrDefault(route.StopIds[^1])))
            .Where(item => item.Location is { Length: 2 })
            .ToList();

        var results = new Dictionary<string, string>(StringComparer.Ordinal);
        using var gate = new SemaphoreSlim(3);
        var tasks = candidates.Select(async candidate =>
        {
            await gate.WaitAsync(cancellationToken);
            try
            {
                var district = await geocodingService.ReverseGeocodeDistrictAsync(
                    candidate.Location!, cancellationToken);
                if (!string.IsNullOrWhiteSpace(district))
                    lock (results) results[candidate.VehicleId] = district;
            }
            finally
            {
                gate.Release();
            }
        });
        await Task.WhenAll(tasks);
        return results;
    }

    private int ServiceSecondsFor(int demand) =>
        _options.StopBaseServiceSeconds + (_options.BoardingSecondsPerPerson * demand);
}
