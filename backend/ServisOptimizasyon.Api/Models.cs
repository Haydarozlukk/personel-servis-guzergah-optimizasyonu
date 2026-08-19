using System.Text.Json.Serialization;

// ---------------------------------------------------------------------------
// Senaryo girdisi
// ---------------------------------------------------------------------------

public sealed record ScenarioInput
{
    public required string Name { get; init; }
    public required string Direction { get; init; }
    public required double[] Workplace { get; init; }
    public required TimeOnly ArrivalDeadline { get; init; }
    public required List<PersonInput> Persons { get; init; }
    public required List<VehicleInput> Vehicles { get; init; }
    public List<string> ImportWarnings { get; init; } = [];

    /// <summary>
    /// Filo boyutu dışarıdan sabit verildiğinde (ör. elde 40 araç var) azami
    /// rota süresi/mesafesi VROOM'a sert bir pencere olarak dayatılmaz; aksi
    /// hâlde sınırlı araç sayısıyla bazı kişiler "atanamadı" sayılabilir.
    /// Otomatik filo boyutlandırmada (<see cref="FleetPlanner"/> varsayılanı)
    /// bu false kalır ve sıkı süre sınırı geçerli olur.
    /// </summary>
    public bool FleetSizeIsFixed { get; init; }

    public int DeadlineSeconds => (int)ArrivalDeadline.ToTimeSpan().TotalSeconds;
}

public sealed record PersonInput(string Id, double[] Location, string? Name = null);
public sealed record VehicleInput(
    string Id,
    int Capacity,
    double[]? Start = null,
    string? Plate = null,
    int ReservedSeats = 0,
    string? Label = null)
{
    public int EffectiveCapacity => Math.Max(0, Capacity - ReservedSeats);
}

public sealed record ScenarioAccepted(Guid Id, string Status);

public sealed record FullReoptimizeRequest(string SnapshotName, ScenarioResult Plan);
/// <summary>
/// Adres önerisi. <see cref="Address"/> Nominatim'in display_name'i; yapılandırılmış
/// alanlar arayüzün "3053. Cadde No: 49" biçiminde okunabilir satır kurabilmesi için
/// var (display_name bina sonuçlarında "49, 3053. Cadde, …" diye numarayla başlıyor).
/// Nominatim kaydında karşılığı yoksa null kalırlar.
/// </summary>
public sealed record GeocodingSuggestion(
    string Address,
    double[] Location,
    string? HouseNumber = null,
    string? Street = null,
    string? Neighbourhood = null,
    string? District = null,
    string? City = null);
public sealed record NearbyServiceResult(string VehicleId, double DistanceMeters, string? NearestStopId, int Load, int EffectiveCapacity);
public sealed record NearbyServicesResponse(string Address, double[] Location, List<NearbyServiceResult> Services);

// ---------------------------------------------------------------------------
// Optimizasyon servisi sözleşmesi (Kerim)
// ---------------------------------------------------------------------------

public sealed record StopGenerationRequest(
    List<PersonInput> Persons,
    int MaxWalkingDistanceMeters,
    int? MaxStopDemand);

public sealed record GeneratedStop(
    string Id,
    double[] Location,
    List<string> AssignedPersonIds,
    Dictionary<string, double> WalkingDistancesMeters,
    Dictionary<string, double> WalkingDurationsSeconds,
    int Demand,
    double QualityScore,
    double AverageWalkingDistanceMeters);

/// <summary>
/// Optimizasyon servisinin ürettiği atanamama gerekçesi:
/// <c>no_candidate_within_limit</c>, <c>no_route</c>, <c>stop_capacity_full</c>.
/// </summary>
public sealed record UnassignedPerson(string Id, string Reason);

public sealed record StopGenerationSummary(
    int StopCount,
    int AssignedPersonCount,
    int UnassignedPersonCount,
    double? AverageWalkingDistanceMeters,
    double? MaximumWalkingDistanceMeters,
    double? AverageWalkingDurationSeconds,
    double? MaximumWalkingDurationSeconds,
    int MatrixChunkCount);

public sealed record StopGenerationResult(
    List<GeneratedStop> Stops,
    List<string> UnassignedPersonIds,
    List<UnassignedPerson> UnassignedPersons,
    StopGenerationSummary Summary);

// ---------------------------------------------------------------------------
// VROOM sözleşmesi
//
// VROOM alan adlarının çoğu tek kelime olduğu için camelCase varsayılanıyla
// örtüşür. `time_window` snake_case'tir; JsonPropertyName olmadan gönderilirse
// VROOM kısıtı sessizce yok sayar ve varış saati uygulanmaz.
// ---------------------------------------------------------------------------

public sealed record VroomRequest(
    List<VroomJob> Jobs,
    List<VroomVehicle> Vehicles,
    VroomOptions Options);

public sealed record VroomJob(
    int Id,
    string Description,
    double[] Location,
    int[] Pickup,
    int Service);

public sealed record VroomVehicle(
    int Id,
    string Description,
    string Profile,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] double[]? Start,
    double[] End,
    int[] Capacity,
    [property: JsonPropertyName("time_window")] int[] TimeWindow,
    [property: JsonPropertyName("max_tasks")] int MaxTasks);

public sealed record VroomOptions(bool G);

public sealed record VroomResponse(
    int Code,
    string? Error,
    List<VroomRoute>? Routes,
    List<VroomUnassigned>? Unassigned);

public sealed record VroomRoute(
    int Vehicle,
    string? Description,
    int Distance,
    int Duration,
    int[]? Pickup,
    string? Geometry,
    List<VroomStep>? Steps);

public sealed record VroomStep(
    string Type,
    int? Job,
    int? Arrival,
    int[]? Load);

public sealed record VroomUnassigned(int Id, string Type);

// ---------------------------------------------------------------------------
// Senaryo sonucu
// ---------------------------------------------------------------------------

public static class ScenarioStatus
{
    public const string Queued = "queued";
    public const string Running = "running";
    public const string Completed = "completed";
    public const string Failed = "failed";
}

public sealed record StopResult(
    string Id,
    double[] Location,
    List<string> AssignedPersonIds,
    Dictionary<string, double> WalkingDistancesMeters,
    Dictionary<string, double> WalkingDurationsSeconds,
    int Demand,
    double QualityScore,
    double AverageWalkingDistanceMeters);

/// <summary>
/// Atanamama gerekçesi. Durak üretiminden gelenler optimizasyon servisinin
/// değerleridir; <c>not_routed</c> backend'e aittir ve VROOM'un durağı hiçbir
/// araca atayamadığı durumu gösterir.
/// </summary>
public sealed record UnassignedPersonResult(string Id, string Reason)
{
    public const string NotRouted = "not_routed";
}

public sealed record RouteStepResult(
    string StopId,
    int ArrivalSeconds,
    int Load);

public sealed record RouteResult(
    string VehicleId,
    int DistanceMeters,
    int DurationSeconds,
    int Load,
    string Geometry,
    List<string> StopIds,
    List<RouteStepResult> Steps,
    int ArrivalSeconds,
    bool DeadlineMet)
{
    /// <summary>
    /// Rotanın kestiği halka kapalı alanların adları. Normalde boştur; dolu
    /// gelmesi OSRM grafiğinin bu alanı henüz kapatmadığını gösterir.
    /// </summary>
    public List<string> RestrictedAreasCrossed { get; init; } = [];
}

/// <summary>
/// Orkestratörün ürettiği, henüz kalıcılaştırılmamış sonuç.
/// <see cref="StopGenerationSummary"/> yalnızca tam optimizasyonda doldurulur;
/// yeniden rotalamada durak üretimi çalışmadığı için <c>null</c> gelir ve
/// kayıtlı özet korunur.
/// </summary>
public sealed record ScenarioComputation(
    List<StopResult> Stops,
    List<RouteResult> Routes,
    List<UnassignedPersonResult> UnassignedPersons,
    bool DeadlineMet,
    List<string> Warnings,
    StopGenerationSummary? StopGenerationSummary)
{
    /// <summary>
    /// Rotası olan araçlar için semte göre önerilen isim (vehicleId -> etiket).
    /// Yalnızca kullanıcı henüz elle bir isim vermemişse (mevcut etiket boşsa)
    /// uygulanır; bkz. <see cref="IScenarioStore.SaveComputationAsync"/>.
    /// </summary>
    public Dictionary<string, string> SuggestedVehicleLabels { get; init; } = [];
}

public sealed record ScenarioResult(
    Guid Id,
    string Name,
    string Status,
    int DeadlineSeconds,
    double[] Workplace,
    List<PersonInput> Persons,
    List<VehicleInput> Vehicles,
    List<StopResult> Stops,
    List<RouteResult> Routes,
    List<string> UnassignedPersonIds,
    List<UnassignedPersonResult> UnassignedPersons,
    bool? DeadlineMet,
    List<string> Warnings,
    StopGenerationSummary? StopGenerationSummary,
    string? Error,
    DateTimeOffset CreatedAt,
    DateTimeOffset UpdatedAt);
