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

public sealed record StopGenerationRequest(
    List<PersonInput> Persons,
    int MaxWalkingDistanceMeters,
    int MaxStopDemand);

public sealed record GeneratedStop(
    string Id,
    double[] Location,
    List<string> AssignedPersonIds,
    Dictionary<string, double> WalkingDistancesMeters,
    Dictionary<string, double> WalkingDurationsSeconds,
    int Demand,
    double QualityScore,
    double AverageWalkingDistanceMeters);

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

public sealed record VroomRequest(
    List<VroomJob> Jobs,
    List<VroomVehicle> Vehicles,
    VroomOptions Options);

public sealed record VroomJob(
    int Id,
    string Description,
    double[] Location,
    int[] Pickup);

public sealed record VroomVehicle(
    int Id,
    string Description,
    string Profile,
    double[] Start,
    double[] End,
    int[] Capacity,
    int[] TimeWindow);

public sealed record VroomOptions(bool G);

public sealed record VroomResponse(
    int Code,
    string? Error,
    List<VroomRoute> Routes,
    List<VroomUnassigned> Unassigned);

public sealed record VroomRoute(
    int Vehicle,
    string? Description,
    int Distance,
    int Duration,
    int[] Pickup,
    string? Geometry,
    List<VroomStep> Steps);

public sealed record VroomStep(string Type, int? Job, int[]? Load);
public sealed record VroomUnassigned(int Id, string Type);

public sealed record RouteResult(
    string VehicleId,
    int DistanceMeters,
    int DurationSeconds,
    int Load,
    string Geometry,
    List<string> StopIds);

public sealed record ScenarioResult(
    Guid Id,
    string Status,
    List<RouteResult> Routes,
    List<string> UnassignedPersonIds,
    StopGenerationSummary? StopGenerationSummary = null,
    string? Error = null);
