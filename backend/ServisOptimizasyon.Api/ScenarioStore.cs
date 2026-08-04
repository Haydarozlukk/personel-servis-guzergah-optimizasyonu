using System.Collections.Concurrent;
using Npgsql;

public interface IScenarioStore
{
    Task EnsureSchemaAsync(CancellationToken cancellationToken);

    /// <summary>Hazırlık kontrolü; deponun erişilebilir olduğunu doğrular.</summary>
    Task PingAsync(CancellationToken cancellationToken);

    Task CreateAsync(Guid scenarioId, ScenarioInput input, CancellationToken cancellationToken);

    Task<ScenarioInput?> TryGetInputAsync(Guid scenarioId, CancellationToken cancellationToken);

    Task<List<StopResult>?> TryGetStopsAsync(Guid scenarioId, CancellationToken cancellationToken);

    /// <summary>Kayıtlı atanamama gerekçeleri; yeniden rotalamada korunur.</summary>
    Task<List<UnassignedPersonResult>> TryGetUnassignedPersonsAsync(
        Guid scenarioId,
        CancellationToken cancellationToken);

    Task<ScenarioResult?> TryGetResultAsync(Guid scenarioId, CancellationToken cancellationToken);

    Task SetStatusAsync(Guid scenarioId, string status, string? error, CancellationToken cancellationToken);

    Task SaveComputationAsync(Guid scenarioId, ScenarioComputation computation, CancellationToken cancellationToken);

    /// <summary>Yeniden hesaplama öncesi rotaları temizler, istenirse araçları değiştirir.</summary>
    Task<bool> PrepareReoptimizeAsync(
        Guid scenarioId,
        List<VehicleInput>? vehicles,
        CancellationToken cancellationToken);
}

public sealed class PostgresScenarioStore(NpgsqlDataSource dataSource) : IScenarioStore
{
    private const string SchemaSql = """
        CREATE TABLE IF NOT EXISTS scenarios (
          id uuid PRIMARY KEY,
          name text NOT NULL,
          direction text NOT NULL CHECK (direction = 'morning_inbound'),
          status text NOT NULL CHECK (status IN ('queued','running','completed','failed')),
          workplace geography(Point, 4326) NOT NULL,
          arrival_deadline_seconds integer NOT NULL CHECK (arrival_deadline_seconds BETWEEN 0 AND 86399),
          deadline_met boolean,
          warnings text[] NOT NULL DEFAULT '{}',
          error text,
          -- Optimizasyon servisinin durak üretim özeti (Kerim, K5). Yalnızca tam
          -- optimizasyonda yazılır; yeniden rotalamada korunur.
          summary_stop_count integer,
          summary_assigned_person_count integer,
          summary_unassigned_person_count integer,
          summary_average_walking_distance_meters double precision,
          summary_maximum_walking_distance_meters double precision,
          summary_average_walking_duration_seconds double precision,
          summary_maximum_walking_duration_seconds double precision,
          summary_matrix_chunk_count integer,
          created_at timestamptz NOT NULL DEFAULT now(),
          updated_at timestamptz NOT NULL DEFAULT now()
        );

        CREATE TABLE IF NOT EXISTS scenario_persons (
          scenario_id uuid NOT NULL REFERENCES scenarios(id) ON DELETE CASCADE,
          person_id text NOT NULL,
          location geography(Point, 4326) NOT NULL,
          PRIMARY KEY (scenario_id, person_id)
        );

        CREATE TABLE IF NOT EXISTS scenario_vehicles (
          scenario_id uuid NOT NULL REFERENCES scenarios(id) ON DELETE CASCADE,
          vehicle_id text NOT NULL,
          capacity integer NOT NULL CHECK (capacity >= 1),
          start_location geography(Point, 4326) NOT NULL,
          PRIMARY KEY (scenario_id, vehicle_id)
        );

        CREATE TABLE IF NOT EXISTS scenario_stops (
          scenario_id uuid NOT NULL REFERENCES scenarios(id) ON DELETE CASCADE,
          stop_id text NOT NULL,
          location geography(Point, 4326) NOT NULL,
          demand integer NOT NULL CHECK (demand >= 0),
          quality_score double precision NOT NULL,
          average_walking_distance_meters double precision NOT NULL DEFAULT 0,
          PRIMARY KEY (scenario_id, stop_id)
        );

        CREATE TABLE IF NOT EXISTS stop_person_assignments (
          scenario_id uuid NOT NULL,
          stop_id text NOT NULL,
          person_id text NOT NULL,
          walking_distance_meters double precision NOT NULL CHECK (walking_distance_meters >= 0),
          walking_duration_seconds double precision,
          PRIMARY KEY (scenario_id, person_id),
          FOREIGN KEY (scenario_id, stop_id)
            REFERENCES scenario_stops(scenario_id, stop_id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS scenario_routes (
          scenario_id uuid NOT NULL REFERENCES scenarios(id) ON DELETE CASCADE,
          vehicle_id text NOT NULL,
          distance_meters integer NOT NULL,
          duration_seconds integer NOT NULL,
          load integer NOT NULL,
          arrival_seconds integer NOT NULL,
          deadline_met boolean NOT NULL,
          geometry text NOT NULL,
          PRIMARY KEY (scenario_id, vehicle_id)
        );

        CREATE TABLE IF NOT EXISTS scenario_route_steps (
          scenario_id uuid NOT NULL,
          vehicle_id text NOT NULL,
          step_index integer NOT NULL,
          stop_id text NOT NULL,
          arrival_seconds integer NOT NULL,
          load integer NOT NULL,
          PRIMARY KEY (scenario_id, vehicle_id, step_index),
          FOREIGN KEY (scenario_id, vehicle_id)
            REFERENCES scenario_routes(scenario_id, vehicle_id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS scenario_unassigned_persons (
          scenario_id uuid NOT NULL REFERENCES scenarios(id) ON DELETE CASCADE,
          person_id text NOT NULL,
          reason text NOT NULL DEFAULT 'no_candidate_within_limit',
          PRIMARY KEY (scenario_id, person_id)
        );

        CREATE INDEX IF NOT EXISTS ix_scenario_stops_location
          ON scenario_stops USING GIST (location);
        CREATE INDEX IF NOT EXISTS ix_scenario_persons_location
          ON scenario_persons USING GIST (location);
        CREATE INDEX IF NOT EXISTS ix_scenarios_created_at
          ON scenarios (created_at DESC);
        """;

    public async Task EnsureSchemaAsync(CancellationToken cancellationToken)
    {
        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        await using var command = new NpgsqlCommand(SchemaSql, connection);
        await command.ExecuteNonQueryAsync(cancellationToken);
    }

    public async Task PingAsync(CancellationToken cancellationToken)
    {
        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        await using var command = new NpgsqlCommand("SELECT 1", connection);
        await command.ExecuteScalarAsync(cancellationToken);
    }

    public async Task CreateAsync(Guid scenarioId, ScenarioInput input, CancellationToken cancellationToken)
    {
        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        await using var transaction = await connection.BeginTransactionAsync(cancellationToken);

        await using (var command = new NpgsqlCommand(
            """
            INSERT INTO scenarios (id, name, direction, status, workplace, arrival_deadline_seconds)
            VALUES (@id, @name, @direction, @status,
                    ST_SetSRID(ST_MakePoint(@lon, @lat), 4326)::geography, @deadline)
            """,
            connection,
            transaction))
        {
            command.Parameters.AddWithValue("id", scenarioId);
            command.Parameters.AddWithValue("name", input.Name);
            command.Parameters.AddWithValue("direction", input.Direction);
            command.Parameters.AddWithValue("status", ScenarioStatus.Queued);
            command.Parameters.AddWithValue("lon", input.Workplace[0]);
            command.Parameters.AddWithValue("lat", input.Workplace[1]);
            command.Parameters.AddWithValue("deadline", input.DeadlineSeconds);
            await command.ExecuteNonQueryAsync(cancellationToken);
        }

        await InsertPersonsAsync(connection, transaction, scenarioId, input.Persons, cancellationToken);
        await InsertVehiclesAsync(connection, transaction, scenarioId, input.Vehicles, cancellationToken);

        await transaction.CommitAsync(cancellationToken);
    }

    public async Task<ScenarioInput?> TryGetInputAsync(Guid scenarioId, CancellationToken cancellationToken)
    {
        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);

        string name;
        string direction;
        double[] workplace;
        int deadlineSeconds;

        await using (var command = new NpgsqlCommand(
            """
            SELECT name, direction,
                   ST_X(workplace::geometry), ST_Y(workplace::geometry),
                   arrival_deadline_seconds
            FROM scenarios WHERE id = @id
            """,
            connection))
        {
            command.Parameters.AddWithValue("id", scenarioId);
            await using var reader = await command.ExecuteReaderAsync(cancellationToken);

            if (!await reader.ReadAsync(cancellationToken))
                return null;

            name = reader.GetString(0);
            direction = reader.GetString(1);
            workplace = [reader.GetDouble(2), reader.GetDouble(3)];
            deadlineSeconds = reader.GetInt32(4);
        }

        var persons = new List<PersonInput>();
        await using (var command = new NpgsqlCommand(
            """
            SELECT person_id, ST_X(location::geometry), ST_Y(location::geometry)
            FROM scenario_persons WHERE scenario_id = @id ORDER BY person_id
            """,
            connection))
        {
            command.Parameters.AddWithValue("id", scenarioId);
            await using var reader = await command.ExecuteReaderAsync(cancellationToken);
            while (await reader.ReadAsync(cancellationToken))
                persons.Add(new PersonInput(reader.GetString(0), [reader.GetDouble(1), reader.GetDouble(2)]));
        }

        var vehicles = new List<VehicleInput>();
        await using (var command = new NpgsqlCommand(
            """
            SELECT vehicle_id, capacity,
                   ST_X(start_location::geometry), ST_Y(start_location::geometry)
            FROM scenario_vehicles WHERE scenario_id = @id ORDER BY vehicle_id
            """,
            connection))
        {
            command.Parameters.AddWithValue("id", scenarioId);
            await using var reader = await command.ExecuteReaderAsync(cancellationToken);
            while (await reader.ReadAsync(cancellationToken))
                vehicles.Add(new VehicleInput(
                    reader.GetString(0),
                    reader.GetInt32(1),
                    [reader.GetDouble(2), reader.GetDouble(3)]));
        }

        return new ScenarioInput
        {
            Name = name,
            Direction = direction,
            Workplace = workplace,
            ArrivalDeadline = TimeOnly.FromTimeSpan(TimeSpan.FromSeconds(deadlineSeconds)),
            Persons = persons,
            Vehicles = vehicles,
        };
    }

    public async Task<List<StopResult>?> TryGetStopsAsync(Guid scenarioId, CancellationToken cancellationToken)
    {
        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        var stops = await ReadStopsAsync(connection, scenarioId, cancellationToken);
        return stops.Count == 0 ? null : stops;
    }

    public async Task<List<UnassignedPersonResult>> TryGetUnassignedPersonsAsync(
        Guid scenarioId,
        CancellationToken cancellationToken)
    {
        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        return await ReadUnassignedPersonsAsync(connection, scenarioId, cancellationToken);
    }

    public async Task<ScenarioResult?> TryGetResultAsync(Guid scenarioId, CancellationToken cancellationToken)
    {
        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);

        string name;
        string status;
        int deadlineSeconds;
        double[] workplace;
        bool? deadlineMet;
        List<string> warnings;
        string? error;
        StopGenerationSummary? summary;
        DateTimeOffset createdAt;
        DateTimeOffset updatedAt;

        await using (var command = new NpgsqlCommand(
            """
            SELECT name, status, arrival_deadline_seconds, deadline_met, warnings, error,
                   created_at, updated_at,
                   summary_stop_count, summary_assigned_person_count, summary_unassigned_person_count,
                   summary_average_walking_distance_meters, summary_maximum_walking_distance_meters,
                   summary_average_walking_duration_seconds, summary_maximum_walking_duration_seconds,
                   summary_matrix_chunk_count,
                   ST_X(workplace::geometry), ST_Y(workplace::geometry)
            FROM scenarios WHERE id = @id
            """,
            connection))
        {
            command.Parameters.AddWithValue("id", scenarioId);
            await using var reader = await command.ExecuteReaderAsync(cancellationToken);

            if (!await reader.ReadAsync(cancellationToken))
                return null;

            name = reader.GetString(0);
            status = reader.GetString(1);
            deadlineSeconds = reader.GetInt32(2);
            deadlineMet = reader.IsDBNull(3) ? null : reader.GetBoolean(3);
            warnings = [.. reader.GetFieldValue<string[]>(4)];
            error = reader.IsDBNull(5) ? null : reader.GetString(5);
            createdAt = reader.GetFieldValue<DateTimeOffset>(6);
            updatedAt = reader.GetFieldValue<DateTimeOffset>(7);

            summary = reader.IsDBNull(8)
                ? null
                : new StopGenerationSummary(
                    reader.GetInt32(8),
                    reader.GetInt32(9),
                    reader.GetInt32(10),
                    reader.IsDBNull(11) ? null : reader.GetDouble(11),
                    reader.IsDBNull(12) ? null : reader.GetDouble(12),
                    reader.IsDBNull(13) ? null : reader.GetDouble(13),
                    reader.IsDBNull(14) ? null : reader.GetDouble(14),
                    reader.IsDBNull(15) ? 0 : reader.GetInt32(15));
            workplace = [reader.GetDouble(16), reader.GetDouble(17)];
        }

        var vehicles = await ReadVehiclesAsync(connection, scenarioId, cancellationToken);
        var stops = await ReadStopsAsync(connection, scenarioId, cancellationToken);
        var routes = await ReadRoutesAsync(connection, scenarioId, cancellationToken);
        var unassignedPersons = await ReadUnassignedPersonsAsync(connection, scenarioId, cancellationToken);

        return new ScenarioResult(
            scenarioId,
            name,
            status,
            deadlineSeconds,
            workplace,
            vehicles,
            stops,
            routes,
            unassignedPersons.Select(person => person.Id).ToList(),
            unassignedPersons,
            deadlineMet,
            warnings,
            summary,
            error,
            createdAt,
            updatedAt);
    }

    private static async Task<List<UnassignedPersonResult>> ReadUnassignedPersonsAsync(
        NpgsqlConnection connection,
        Guid scenarioId,
        CancellationToken cancellationToken)
    {
        var unassigned = new List<UnassignedPersonResult>();

        await using var command = new NpgsqlCommand(
            """
            SELECT person_id, reason FROM scenario_unassigned_persons
            WHERE scenario_id = @id ORDER BY person_id
            """,
            connection);
        command.Parameters.AddWithValue("id", scenarioId);

        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        while (await reader.ReadAsync(cancellationToken))
            unassigned.Add(new UnassignedPersonResult(reader.GetString(0), reader.GetString(1)));

        return unassigned;
    }

    public async Task SetStatusAsync(
        Guid scenarioId,
        string status,
        string? error,
        CancellationToken cancellationToken)
    {
        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        await using var command = new NpgsqlCommand(
            "UPDATE scenarios SET status = @status, error = @error, updated_at = now() WHERE id = @id",
            connection);
        command.Parameters.AddWithValue("id", scenarioId);
        command.Parameters.AddWithValue("status", status);
        command.Parameters.AddWithValue("error", (object?)error ?? DBNull.Value);
        await command.ExecuteNonQueryAsync(cancellationToken);
    }

    public async Task SaveComputationAsync(
        Guid scenarioId,
        ScenarioComputation computation,
        CancellationToken cancellationToken)
    {
        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        await using var transaction = await connection.BeginTransactionAsync(cancellationToken);

        await ExecuteAsync(connection, transaction, scenarioId,
            "DELETE FROM scenario_routes WHERE scenario_id = @id", cancellationToken);
        await ExecuteAsync(connection, transaction, scenarioId,
            "DELETE FROM scenario_stops WHERE scenario_id = @id", cancellationToken);
        await ExecuteAsync(connection, transaction, scenarioId,
            "DELETE FROM scenario_unassigned_persons WHERE scenario_id = @id", cancellationToken);

        foreach (var stop in computation.Stops)
        {
            await using (var command = new NpgsqlCommand(
                """
                INSERT INTO scenario_stops
                    (scenario_id, stop_id, location, demand, quality_score, average_walking_distance_meters)
                VALUES (@id, @stop, ST_SetSRID(ST_MakePoint(@lon, @lat), 4326)::geography,
                        @demand, @score, @average)
                """,
                connection,
                transaction))
            {
                command.Parameters.AddWithValue("id", scenarioId);
                command.Parameters.AddWithValue("stop", stop.Id);
                command.Parameters.AddWithValue("lon", stop.Location[0]);
                command.Parameters.AddWithValue("lat", stop.Location[1]);
                command.Parameters.AddWithValue("demand", stop.Demand);
                command.Parameters.AddWithValue("score", stop.QualityScore);
                command.Parameters.AddWithValue("average", stop.AverageWalkingDistanceMeters);
                await command.ExecuteNonQueryAsync(cancellationToken);
            }

            foreach (var personId in stop.AssignedPersonIds)
            {
                await using var command = new NpgsqlCommand(
                    """
                    INSERT INTO stop_person_assignments
                        (scenario_id, stop_id, person_id, walking_distance_meters, walking_duration_seconds)
                    VALUES (@id, @stop, @person, @distance, @duration)
                    """,
                    connection,
                    transaction);
                command.Parameters.AddWithValue("id", scenarioId);
                command.Parameters.AddWithValue("stop", stop.Id);
                command.Parameters.AddWithValue("person", personId);
                command.Parameters.AddWithValue(
                    "distance",
                    stop.WalkingDistancesMeters.TryGetValue(personId, out var distance) ? distance : 0d);
                command.Parameters.AddWithValue(
                    "duration",
                    stop.WalkingDurationsSeconds.TryGetValue(personId, out var duration)
                        ? duration
                        : (object)DBNull.Value);
                await command.ExecuteNonQueryAsync(cancellationToken);
            }
        }

        foreach (var route in computation.Routes)
        {
            await using (var command = new NpgsqlCommand(
                """
                INSERT INTO scenario_routes
                    (scenario_id, vehicle_id, distance_meters, duration_seconds, load,
                     arrival_seconds, deadline_met, geometry)
                VALUES (@id, @vehicle, @distance, @duration, @load, @arrival, @met, @geometry)
                """,
                connection,
                transaction))
            {
                command.Parameters.AddWithValue("id", scenarioId);
                command.Parameters.AddWithValue("vehicle", route.VehicleId);
                command.Parameters.AddWithValue("distance", route.DistanceMeters);
                command.Parameters.AddWithValue("duration", route.DurationSeconds);
                command.Parameters.AddWithValue("load", route.Load);
                command.Parameters.AddWithValue("arrival", route.ArrivalSeconds);
                command.Parameters.AddWithValue("met", route.DeadlineMet);
                command.Parameters.AddWithValue("geometry", route.Geometry);
                await command.ExecuteNonQueryAsync(cancellationToken);
            }

            for (var index = 0; index < route.Steps.Count; index++)
            {
                var step = route.Steps[index];
                await using var command = new NpgsqlCommand(
                    """
                    INSERT INTO scenario_route_steps
                        (scenario_id, vehicle_id, step_index, stop_id, arrival_seconds, load)
                    VALUES (@id, @vehicle, @index, @stop, @arrival, @load)
                    """,
                    connection,
                    transaction);
                command.Parameters.AddWithValue("id", scenarioId);
                command.Parameters.AddWithValue("vehicle", route.VehicleId);
                command.Parameters.AddWithValue("index", index);
                command.Parameters.AddWithValue("stop", step.StopId);
                command.Parameters.AddWithValue("arrival", step.ArrivalSeconds);
                command.Parameters.AddWithValue("load", step.Load);
                await command.ExecuteNonQueryAsync(cancellationToken);
            }
        }

        foreach (var person in computation.UnassignedPersons)
        {
            await using var command = new NpgsqlCommand(
                """
                INSERT INTO scenario_unassigned_persons (scenario_id, person_id, reason)
                VALUES (@id, @person, @reason)
                """,
                connection,
                transaction);
            command.Parameters.AddWithValue("id", scenarioId);
            command.Parameters.AddWithValue("person", person.Id);
            command.Parameters.AddWithValue("reason", person.Reason);
            await command.ExecuteNonQueryAsync(cancellationToken);
        }

        await using (var command = new NpgsqlCommand(
            """
            UPDATE scenarios
            SET status = @status, deadline_met = @met, warnings = @warnings,
                error = NULL, updated_at = now()
            WHERE id = @id
            """,
            connection,
            transaction))
        {
            command.Parameters.AddWithValue("id", scenarioId);
            command.Parameters.AddWithValue("status", ScenarioStatus.Completed);
            command.Parameters.AddWithValue("met", computation.DeadlineMet);
            command.Parameters.AddWithValue("warnings", computation.Warnings.ToArray());
            await command.ExecuteNonQueryAsync(cancellationToken);
        }

        // Özet yalnızca durak üretimi çalıştığında gelir; yeniden rotalamada
        // null geçilir ve kayıtlı değer korunur.
        if (computation.StopGenerationSummary is { } summary)
        {
            await using var command = new NpgsqlCommand(
                """
                UPDATE scenarios
                SET summary_stop_count = @stopCount,
                    summary_assigned_person_count = @assigned,
                    summary_unassigned_person_count = @unassigned,
                    summary_average_walking_distance_meters = @avgDistance,
                    summary_maximum_walking_distance_meters = @maxDistance,
                    summary_average_walking_duration_seconds = @avgDuration,
                    summary_maximum_walking_duration_seconds = @maxDuration,
                    summary_matrix_chunk_count = @chunks
                WHERE id = @id
                """,
                connection,
                transaction);
            command.Parameters.AddWithValue("id", scenarioId);
            command.Parameters.AddWithValue("stopCount", summary.StopCount);
            command.Parameters.AddWithValue("assigned", summary.AssignedPersonCount);
            command.Parameters.AddWithValue("unassigned", summary.UnassignedPersonCount);
            command.Parameters.AddWithValue("avgDistance", Nullable(summary.AverageWalkingDistanceMeters));
            command.Parameters.AddWithValue("maxDistance", Nullable(summary.MaximumWalkingDistanceMeters));
            command.Parameters.AddWithValue("avgDuration", Nullable(summary.AverageWalkingDurationSeconds));
            command.Parameters.AddWithValue("maxDuration", Nullable(summary.MaximumWalkingDurationSeconds));
            command.Parameters.AddWithValue("chunks", summary.MatrixChunkCount);
            await command.ExecuteNonQueryAsync(cancellationToken);
        }

        await transaction.CommitAsync(cancellationToken);
    }

    public async Task<bool> PrepareReoptimizeAsync(
        Guid scenarioId,
        List<VehicleInput>? vehicles,
        CancellationToken cancellationToken)
    {
        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        await using var transaction = await connection.BeginTransactionAsync(cancellationToken);

        await using (var command = new NpgsqlCommand(
            "SELECT count(*) FROM scenario_stops WHERE scenario_id = @id",
            connection,
            transaction))
        {
            command.Parameters.AddWithValue("id", scenarioId);
            var stopCount = Convert.ToInt64(await command.ExecuteScalarAsync(cancellationToken));

            if (stopCount == 0)
                return false;
        }

        if (vehicles is { Count: > 0 })
        {
            await ExecuteAsync(connection, transaction, scenarioId,
                "DELETE FROM scenario_vehicles WHERE scenario_id = @id", cancellationToken);
            await InsertVehiclesAsync(connection, transaction, scenarioId, vehicles, cancellationToken);
        }

        await ExecuteAsync(connection, transaction, scenarioId,
            "DELETE FROM scenario_routes WHERE scenario_id = @id", cancellationToken);
        await ExecuteAsync(connection, transaction, scenarioId,
            "DELETE FROM scenario_unassigned_persons WHERE scenario_id = @id", cancellationToken);

        await using (var command = new NpgsqlCommand(
            """
            UPDATE scenarios
            SET status = @status, deadline_met = NULL, error = NULL, updated_at = now()
            WHERE id = @id
            """,
            connection,
            transaction))
        {
            command.Parameters.AddWithValue("id", scenarioId);
            command.Parameters.AddWithValue("status", ScenarioStatus.Queued);
            await command.ExecuteNonQueryAsync(cancellationToken);
        }

        await transaction.CommitAsync(cancellationToken);
        return true;
    }

    private static async Task<List<VehicleInput>> ReadVehiclesAsync(
        NpgsqlConnection connection,
        Guid scenarioId,
        CancellationToken cancellationToken)
    {
        var vehicles = new List<VehicleInput>();
        await using var command = new NpgsqlCommand(
            """
            SELECT vehicle_id, capacity,
                   ST_X(start_location::geometry), ST_Y(start_location::geometry)
            FROM scenario_vehicles WHERE scenario_id = @id ORDER BY vehicle_id
            """,
            connection);
        command.Parameters.AddWithValue("id", scenarioId);
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        while (await reader.ReadAsync(cancellationToken))
        {
            vehicles.Add(new VehicleInput(
                reader.GetString(0),
                reader.GetInt32(1),
                [reader.GetDouble(2), reader.GetDouble(3)]));
        }

        return vehicles;
    }

    private static async Task<List<StopResult>> ReadStopsAsync(
        NpgsqlConnection connection,
        Guid scenarioId,
        CancellationToken cancellationToken)
    {
        var stops = new Dictionary<string, (double[] Location, int Demand, double Score, double Average)>(
            StringComparer.Ordinal);
        var order = new List<string>();

        await using (var command = new NpgsqlCommand(
            """
            SELECT stop_id, ST_X(location::geometry), ST_Y(location::geometry),
                   demand, quality_score, average_walking_distance_meters
            FROM scenario_stops WHERE scenario_id = @id ORDER BY stop_id
            """,
            connection))
        {
            command.Parameters.AddWithValue("id", scenarioId);
            await using var reader = await command.ExecuteReaderAsync(cancellationToken);
            while (await reader.ReadAsync(cancellationToken))
            {
                var stopId = reader.GetString(0);
                order.Add(stopId);
                stops[stopId] = (
                    [reader.GetDouble(1), reader.GetDouble(2)],
                    reader.GetInt32(3),
                    reader.GetDouble(4),
                    reader.GetDouble(5));
            }
        }

        var distancesByStop = order.ToDictionary(
            stopId => stopId,
            _ => new Dictionary<string, double>(StringComparer.Ordinal),
            StringComparer.Ordinal);
        var durationsByStop = order.ToDictionary(
            stopId => stopId,
            _ => new Dictionary<string, double>(StringComparer.Ordinal),
            StringComparer.Ordinal);

        await using (var command = new NpgsqlCommand(
            """
            SELECT stop_id, person_id, walking_distance_meters, walking_duration_seconds
            FROM stop_person_assignments WHERE scenario_id = @id ORDER BY stop_id, person_id
            """,
            connection))
        {
            command.Parameters.AddWithValue("id", scenarioId);
            await using var reader = await command.ExecuteReaderAsync(cancellationToken);
            while (await reader.ReadAsync(cancellationToken))
            {
                var stopId = reader.GetString(0);

                if (!distancesByStop.TryGetValue(stopId, out var distances))
                    continue;

                var personId = reader.GetString(1);
                distances[personId] = reader.GetDouble(2);

                if (!reader.IsDBNull(3))
                    durationsByStop[stopId][personId] = reader.GetDouble(3);
            }
        }

        return order
            .Select(stopId => new StopResult(
                stopId,
                stops[stopId].Location,
                [.. distancesByStop[stopId].Keys],
                distancesByStop[stopId],
                durationsByStop[stopId],
                stops[stopId].Demand,
                stops[stopId].Score,
                stops[stopId].Average))
            .ToList();
    }

    private static async Task<List<RouteResult>> ReadRoutesAsync(
        NpgsqlConnection connection,
        Guid scenarioId,
        CancellationToken cancellationToken)
    {
        var steps = new Dictionary<string, List<RouteStepResult>>(StringComparer.Ordinal);

        await using (var command = new NpgsqlCommand(
            """
            SELECT vehicle_id, stop_id, arrival_seconds, load
            FROM scenario_route_steps WHERE scenario_id = @id ORDER BY vehicle_id, step_index
            """,
            connection))
        {
            command.Parameters.AddWithValue("id", scenarioId);
            await using var reader = await command.ExecuteReaderAsync(cancellationToken);
            while (await reader.ReadAsync(cancellationToken))
            {
                var vehicleId = reader.GetString(0);

                if (!steps.TryGetValue(vehicleId, out var list))
                {
                    list = [];
                    steps[vehicleId] = list;
                }

                list.Add(new RouteStepResult(reader.GetString(1), reader.GetInt32(2), reader.GetInt32(3)));
            }
        }

        var routes = new List<RouteResult>();

        await using (var command = new NpgsqlCommand(
            """
            SELECT vehicle_id, distance_meters, duration_seconds, load, arrival_seconds, deadline_met, geometry
            FROM scenario_routes WHERE scenario_id = @id ORDER BY vehicle_id
            """,
            connection))
        {
            command.Parameters.AddWithValue("id", scenarioId);
            await using var reader = await command.ExecuteReaderAsync(cancellationToken);
            while (await reader.ReadAsync(cancellationToken))
            {
                var vehicleId = reader.GetString(0);
                var vehicleSteps = steps.TryGetValue(vehicleId, out var list)
                    ? list
                    : new List<RouteStepResult>();

                routes.Add(new RouteResult(
                    vehicleId,
                    reader.GetInt32(1),
                    reader.GetInt32(2),
                    reader.GetInt32(3),
                    reader.GetString(6),
                    vehicleSteps.Select(step => step.StopId).ToList(),
                    vehicleSteps,
                    reader.GetInt32(4),
                    reader.GetBoolean(5)));
            }
        }

        return routes;
    }

    private static async Task InsertPersonsAsync(
        NpgsqlConnection connection,
        NpgsqlTransaction transaction,
        Guid scenarioId,
        List<PersonInput> persons,
        CancellationToken cancellationToken)
    {
        foreach (var person in persons)
        {
            await using var command = new NpgsqlCommand(
                """
                INSERT INTO scenario_persons (scenario_id, person_id, location)
                VALUES (@id, @person, ST_SetSRID(ST_MakePoint(@lon, @lat), 4326)::geography)
                """,
                connection,
                transaction);
            command.Parameters.AddWithValue("id", scenarioId);
            command.Parameters.AddWithValue("person", person.Id);
            command.Parameters.AddWithValue("lon", person.Location[0]);
            command.Parameters.AddWithValue("lat", person.Location[1]);
            await command.ExecuteNonQueryAsync(cancellationToken);
        }
    }

    private static async Task InsertVehiclesAsync(
        NpgsqlConnection connection,
        NpgsqlTransaction transaction,
        Guid scenarioId,
        List<VehicleInput> vehicles,
        CancellationToken cancellationToken)
    {
        foreach (var vehicle in vehicles)
        {
            await using var command = new NpgsqlCommand(
                """
                INSERT INTO scenario_vehicles (scenario_id, vehicle_id, capacity, start_location)
                VALUES (@id, @vehicle, @capacity, ST_SetSRID(ST_MakePoint(@lon, @lat), 4326)::geography)
                """,
                connection,
                transaction);
            command.Parameters.AddWithValue("id", scenarioId);
            command.Parameters.AddWithValue("vehicle", vehicle.Id);
            command.Parameters.AddWithValue("capacity", vehicle.Capacity);
            command.Parameters.AddWithValue("lon", vehicle.Start[0]);
            command.Parameters.AddWithValue("lat", vehicle.Start[1]);
            await command.ExecuteNonQueryAsync(cancellationToken);
        }
    }

    private static async Task ExecuteAsync(
        NpgsqlConnection connection,
        NpgsqlTransaction transaction,
        Guid scenarioId,
        string sql,
        CancellationToken cancellationToken)
    {
        await using var command = new NpgsqlCommand(sql, connection, transaction);
        command.Parameters.AddWithValue("id", scenarioId);
        await command.ExecuteNonQueryAsync(cancellationToken);
    }

    private static object Nullable(double? value) => value.HasValue ? value.Value : DBNull.Value;
}

/// <summary>
/// Bağlantı dizesi tanımlı olmadığında kullanılan yedek depo. Yalnızca Postgres'siz
/// yerel geliştirme içindir; süreç yeniden başladığında veri kaybolur.
/// </summary>
public sealed class InMemoryScenarioStore : IScenarioStore
{
    private sealed record Entry(
        ScenarioInput Input,
        string Status,
        ScenarioComputation? Computation,
        StopGenerationSummary? Summary,
        string? Error,
        DateTimeOffset CreatedAt,
        DateTimeOffset UpdatedAt);

    private readonly ConcurrentDictionary<Guid, Entry> _entries = new();

    public Task EnsureSchemaAsync(CancellationToken cancellationToken) => Task.CompletedTask;

    public Task PingAsync(CancellationToken cancellationToken) => Task.CompletedTask;

    public Task CreateAsync(Guid scenarioId, ScenarioInput input, CancellationToken cancellationToken)
    {
        var now = DateTimeOffset.UtcNow;
        _entries[scenarioId] = new Entry(input, ScenarioStatus.Queued, null, null, null, now, now);
        return Task.CompletedTask;
    }

    public Task<ScenarioInput?> TryGetInputAsync(Guid scenarioId, CancellationToken cancellationToken) =>
        Task.FromResult(_entries.TryGetValue(scenarioId, out var entry) ? entry.Input : null);

    public Task<List<StopResult>?> TryGetStopsAsync(Guid scenarioId, CancellationToken cancellationToken) =>
        Task.FromResult(
            _entries.TryGetValue(scenarioId, out var entry) && entry.Computation is { Stops.Count: > 0 }
                ? entry.Computation.Stops
                : null);

    public Task<List<UnassignedPersonResult>> TryGetUnassignedPersonsAsync(
        Guid scenarioId,
        CancellationToken cancellationToken) =>
        Task.FromResult(
            _entries.TryGetValue(scenarioId, out var entry) && entry.Computation is not null
                ? entry.Computation.UnassignedPersons
                : []);

    public Task<ScenarioResult?> TryGetResultAsync(Guid scenarioId, CancellationToken cancellationToken)
    {
        if (!_entries.TryGetValue(scenarioId, out var entry))
            return Task.FromResult<ScenarioResult?>(null);

        var computation = entry.Computation;
        List<UnassignedPersonResult> unassignedPersons = computation?.UnassignedPersons ?? [];

        return Task.FromResult<ScenarioResult?>(new ScenarioResult(
            scenarioId,
            entry.Input.Name,
            entry.Status,
            entry.Input.DeadlineSeconds,
            entry.Input.Workplace,
            entry.Input.Vehicles,
            computation?.Stops ?? [],
            computation?.Routes ?? [],
            unassignedPersons.Select(person => person.Id).ToList(),
            unassignedPersons,
            computation?.DeadlineMet,
            computation?.Warnings ?? [],
            entry.Summary,
            entry.Error,
            entry.CreatedAt,
            entry.UpdatedAt));
    }

    public Task SetStatusAsync(Guid scenarioId, string status, string? error, CancellationToken cancellationToken)
    {
        _entries.AddOrUpdate(
            scenarioId,
            _ => throw new InvalidOperationException($"Senaryo bulunamadı: {scenarioId}."),
            (_, entry) => entry with { Status = status, Error = error, UpdatedAt = DateTimeOffset.UtcNow });
        return Task.CompletedTask;
    }

    public Task SaveComputationAsync(
        Guid scenarioId,
        ScenarioComputation computation,
        CancellationToken cancellationToken)
    {
        _entries.AddOrUpdate(
            scenarioId,
            _ => throw new InvalidOperationException($"Senaryo bulunamadı: {scenarioId}."),
            (_, entry) => entry with
            {
                Status = ScenarioStatus.Completed,
                Computation = computation,
                // Özet yalnızca durak üretimi çalıştığında gelir; yeniden
                // rotalamada kayıtlı değer korunur.
                Summary = computation.StopGenerationSummary ?? entry.Summary,
                Error = null,
                UpdatedAt = DateTimeOffset.UtcNow,
            });
        return Task.CompletedTask;
    }

    public Task<bool> PrepareReoptimizeAsync(
        Guid scenarioId,
        List<VehicleInput>? vehicles,
        CancellationToken cancellationToken)
    {
        if (!_entries.TryGetValue(scenarioId, out var entry) || entry.Computation is not { Stops.Count: > 0 })
            return Task.FromResult(false);

        var input = vehicles is { Count: > 0 } ? entry.Input with { Vehicles = vehicles } : entry.Input;

        _entries[scenarioId] = entry with
        {
            Input = input,
            Status = ScenarioStatus.Queued,
            Computation = new ScenarioComputation(
                entry.Computation.Stops,
                [],
                entry.Computation.UnassignedPersons,
                false,
                [],
                null),
            Error = null,
            UpdatedAt = DateTimeOffset.UtcNow,
        };

        return Task.FromResult(true);
    }
}
