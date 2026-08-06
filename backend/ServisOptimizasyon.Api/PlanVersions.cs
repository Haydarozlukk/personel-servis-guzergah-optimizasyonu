using System.Collections.Concurrent;
using System.Text.Json;
using Npgsql;
using NpgsqlTypes;

public sealed record SavePlanVersionRequest(string Name, string? Description, ScenarioResult Plan);
public sealed record PlanVersionSummary(
    Guid Id,
    string Name,
    string? Description,
    string CreatedBy,
    DateTimeOffset CreatedAt,
    bool IsActive);

public interface IPlanVersionStore
{
    Task EnsureSchemaAsync(CancellationToken cancellationToken);
    Task<ScenarioResult?> TryGetActivePlanAsync(Guid scenarioId, CancellationToken cancellationToken);
    Task<bool> SetActivePlanAsync(Guid scenarioId, ScenarioResult plan, CancellationToken cancellationToken);
    Task<PlanVersionSummary> SaveAsync(
        Guid scenarioId,
        string name,
        string? description,
        ScenarioResult plan,
        string createdBy,
        CancellationToken cancellationToken);
    Task<List<PlanVersionSummary>> ListAsync(Guid scenarioId, CancellationToken cancellationToken);
    Task<bool> ActivateAsync(Guid scenarioId, Guid versionId, CancellationToken cancellationToken);
    Task<bool> DeleteAsync(Guid scenarioId, Guid versionId, CancellationToken cancellationToken);
    Task ClearActivePlanAsync(Guid scenarioId, CancellationToken cancellationToken);
}

public sealed class PostgresPlanVersionStore(NpgsqlDataSource dataSource) : IPlanVersionStore
{
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);
    private const string SchemaSql = """
        ALTER TABLE scenarios ADD COLUMN IF NOT EXISTS active_plan jsonb;
        ALTER TABLE scenarios ADD COLUMN IF NOT EXISTS active_version_id uuid;
        CREATE TABLE IF NOT EXISTS scenario_versions (
          id uuid PRIMARY KEY,
          scenario_id uuid NOT NULL REFERENCES scenarios(id) ON DELETE CASCADE,
          name text NOT NULL,
          description text,
          snapshot jsonb NOT NULL,
          created_by text NOT NULL,
          created_at timestamptz NOT NULL DEFAULT now()
        );
        CREATE INDEX IF NOT EXISTS ix_scenario_versions_scenario
          ON scenario_versions(scenario_id, created_at DESC);
        """;

    public async Task EnsureSchemaAsync(CancellationToken cancellationToken)
    {
        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        await using var command = new NpgsqlCommand(SchemaSql, connection);
        await command.ExecuteNonQueryAsync(cancellationToken);
    }

    public async Task<ScenarioResult?> TryGetActivePlanAsync(Guid scenarioId, CancellationToken cancellationToken)
    {
        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        await using var command = new NpgsqlCommand("SELECT active_plan::text FROM scenarios WHERE id = @id", connection);
        command.Parameters.AddWithValue("id", scenarioId);
        var value = await command.ExecuteScalarAsync(cancellationToken);
        return value is string json ? JsonSerializer.Deserialize<ScenarioResult>(json, JsonOptions) : null;
    }

    public async Task<bool> SetActivePlanAsync(Guid scenarioId, ScenarioResult plan, CancellationToken cancellationToken)
    {
        var json = JsonSerializer.Serialize(plan, JsonOptions);
        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        await using var command = new NpgsqlCommand(
            "UPDATE scenarios SET active_plan = @plan, active_version_id = NULL, updated_at = now() WHERE id = @scenario",
            connection);
        command.Parameters.AddWithValue("plan", NpgsqlDbType.Jsonb, json);
        command.Parameters.AddWithValue("scenario", scenarioId);
        return await command.ExecuteNonQueryAsync(cancellationToken) == 1;
    }

    public async Task<PlanVersionSummary> SaveAsync(
        Guid scenarioId,
        string name,
        string? description,
        ScenarioResult plan,
        string createdBy,
        CancellationToken cancellationToken)
    {
        var id = Guid.NewGuid();
        var now = DateTimeOffset.UtcNow;
        var json = JsonSerializer.Serialize(plan, JsonOptions);
        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        await using var transaction = await connection.BeginTransactionAsync(cancellationToken);
        await using (var command = new NpgsqlCommand(
            """
            INSERT INTO scenario_versions(id, scenario_id, name, description, snapshot, created_by, created_at)
            VALUES (@version, @scenario, @name, @description, @snapshot, @createdBy, @createdAt)
            """, connection, transaction))
        {
            command.Parameters.AddWithValue("version", id);
            command.Parameters.AddWithValue("scenario", scenarioId);
            command.Parameters.AddWithValue("name", name.Trim());
            command.Parameters.AddWithValue("description", (object?)description?.Trim() ?? DBNull.Value);
            command.Parameters.AddWithValue("snapshot", NpgsqlDbType.Jsonb, json);
            command.Parameters.AddWithValue("createdBy", createdBy);
            command.Parameters.AddWithValue("createdAt", now);
            await command.ExecuteNonQueryAsync(cancellationToken);
        }
        await using (var command = new NpgsqlCommand(
            "UPDATE scenarios SET active_plan = @snapshot, active_version_id = @version, updated_at = now() WHERE id = @scenario",
            connection, transaction))
        {
            command.Parameters.AddWithValue("snapshot", NpgsqlDbType.Jsonb, json);
            command.Parameters.AddWithValue("version", id);
            command.Parameters.AddWithValue("scenario", scenarioId);
            if (await command.ExecuteNonQueryAsync(cancellationToken) != 1)
                throw new InvalidOperationException("Senaryo bulunamadı.");
        }
        await transaction.CommitAsync(cancellationToken);
        return new PlanVersionSummary(id, name.Trim(), description?.Trim(), createdBy, now, true);
    }

    public async Task<List<PlanVersionSummary>> ListAsync(Guid scenarioId, CancellationToken cancellationToken)
    {
        var versions = new List<PlanVersionSummary>();
        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        await using var command = new NpgsqlCommand(
            """
            SELECT v.id, v.name, v.description, v.created_by, v.created_at,
                   COALESCE(v.id = s.active_version_id, false)
            FROM scenario_versions v JOIN scenarios s ON s.id = v.scenario_id
            WHERE v.scenario_id = @scenario ORDER BY v.created_at DESC
            """, connection);
        command.Parameters.AddWithValue("scenario", scenarioId);
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        while (await reader.ReadAsync(cancellationToken))
            versions.Add(new PlanVersionSummary(
                reader.GetGuid(0), reader.GetString(1), reader.IsDBNull(2) ? null : reader.GetString(2),
                reader.GetString(3), reader.GetFieldValue<DateTimeOffset>(4), reader.GetBoolean(5)));
        return versions;
    }

    public async Task<bool> ActivateAsync(Guid scenarioId, Guid versionId, CancellationToken cancellationToken)
    {
        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        await using var command = new NpgsqlCommand(
            """
            UPDATE scenarios s SET active_plan = v.snapshot, active_version_id = v.id, updated_at = now()
            FROM scenario_versions v
            WHERE s.id = @scenario AND v.id = @version AND v.scenario_id = s.id
            """, connection);
        command.Parameters.AddWithValue("scenario", scenarioId);
        command.Parameters.AddWithValue("version", versionId);
        return await command.ExecuteNonQueryAsync(cancellationToken) == 1;
    }

    public async Task<bool> DeleteAsync(Guid scenarioId, Guid versionId, CancellationToken cancellationToken)
    {
        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        await using var transaction = await connection.BeginTransactionAsync(cancellationToken);
        await using (var detach = new NpgsqlCommand(
            "UPDATE scenarios SET active_version_id = NULL WHERE id = @scenario AND active_version_id = @version",
            connection, transaction))
        {
            detach.Parameters.AddWithValue("scenario", scenarioId);
            detach.Parameters.AddWithValue("version", versionId);
            await detach.ExecuteNonQueryAsync(cancellationToken);
        }
        await using var command = new NpgsqlCommand(
            "DELETE FROM scenario_versions WHERE scenario_id = @scenario AND id = @version",
            connection, transaction);
        command.Parameters.AddWithValue("scenario", scenarioId);
        command.Parameters.AddWithValue("version", versionId);
        var deleted = await command.ExecuteNonQueryAsync(cancellationToken) == 1;
        await transaction.CommitAsync(cancellationToken);
        return deleted;
    }

    public async Task ClearActivePlanAsync(Guid scenarioId, CancellationToken cancellationToken)
    {
        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        await using var command = new NpgsqlCommand(
            "UPDATE scenarios SET active_plan = NULL, active_version_id = NULL WHERE id = @scenario", connection);
        command.Parameters.AddWithValue("scenario", scenarioId);
        await command.ExecuteNonQueryAsync(cancellationToken);
    }
}

public sealed class InMemoryPlanVersionStore : IPlanVersionStore
{
    private sealed record Version(PlanVersionSummary Summary, ScenarioResult Plan);
    private readonly ConcurrentDictionary<Guid, List<Version>> _versions = new();
    private readonly ConcurrentDictionary<Guid, ScenarioResult> _active = new();
    private readonly ConcurrentDictionary<Guid, Guid> _activeIds = new();

    public Task EnsureSchemaAsync(CancellationToken cancellationToken) => Task.CompletedTask;
    public Task<ScenarioResult?> TryGetActivePlanAsync(Guid scenarioId, CancellationToken cancellationToken) =>
        Task.FromResult(_active.TryGetValue(scenarioId, out var plan) ? plan : null);

    public Task<bool> SetActivePlanAsync(Guid scenarioId, ScenarioResult plan, CancellationToken cancellationToken)
    {
        _active[scenarioId] = plan;
        _activeIds.TryRemove(scenarioId, out _);
        return Task.FromResult(true);
    }

    public Task<PlanVersionSummary> SaveAsync(Guid scenarioId, string name, string? description, ScenarioResult plan, string createdBy, CancellationToken cancellationToken)
    {
        var id = Guid.NewGuid();
        var now = DateTimeOffset.UtcNow;
        var summary = new PlanVersionSummary(id, name.Trim(), description?.Trim(), createdBy, now, true);
        var list = _versions.GetOrAdd(scenarioId, _ => []);
        lock (list) list.Add(new Version(summary, plan));
        _active[scenarioId] = plan;
        _activeIds[scenarioId] = id;
        return Task.FromResult(summary);
    }

    public Task<List<PlanVersionSummary>> ListAsync(Guid scenarioId, CancellationToken cancellationToken)
    {
        if (!_versions.TryGetValue(scenarioId, out var list)) return Task.FromResult(new List<PlanVersionSummary>());
        lock (list)
            return Task.FromResult(list.OrderByDescending(v => v.Summary.CreatedAt)
                .Select(v => v.Summary with { IsActive = _activeIds.TryGetValue(scenarioId, out var id) && id == v.Summary.Id }).ToList());
    }

    public Task<bool> ActivateAsync(Guid scenarioId, Guid versionId, CancellationToken cancellationToken)
    {
        if (!_versions.TryGetValue(scenarioId, out var list)) return Task.FromResult(false);
        lock (list)
        {
            var version = list.FirstOrDefault(item => item.Summary.Id == versionId);
            if (version is null) return Task.FromResult(false);
            _active[scenarioId] = version.Plan;
            _activeIds[scenarioId] = versionId;
            return Task.FromResult(true);
        }
    }

    public Task<bool> DeleteAsync(Guid scenarioId, Guid versionId, CancellationToken cancellationToken)
    {
        if (!_versions.TryGetValue(scenarioId, out var list)) return Task.FromResult(false);
        lock (list)
        {
            var removed = list.RemoveAll(item => item.Summary.Id == versionId) == 1;
            if (_activeIds.TryGetValue(scenarioId, out var active) && active == versionId) _activeIds.TryRemove(scenarioId, out _);
            return Task.FromResult(removed);
        }
    }

    public Task ClearActivePlanAsync(Guid scenarioId, CancellationToken cancellationToken)
    {
        _active.TryRemove(scenarioId, out _);
        _activeIds.TryRemove(scenarioId, out _);
        return Task.CompletedTask;
    }
}
