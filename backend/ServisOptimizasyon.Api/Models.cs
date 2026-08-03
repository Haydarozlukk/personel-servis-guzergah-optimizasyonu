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
    int MaxWalkingDistanceMeters);

public sealed record GeneratedStop(
    string Id,
    double[] Location,
    List<string> AssignedPersonIds,
    Dictionary<string, double> WalkingDistancesMeters,
    int Demand,
    double QualityScore);

public sealed record StopGenerationResult(
    List<GeneratedStop> Stops,
    List<string> UnassignedPersonIds);

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
    string? Error = null);
