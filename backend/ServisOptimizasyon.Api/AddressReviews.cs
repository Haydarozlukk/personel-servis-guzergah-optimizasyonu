using Npgsql;

public sealed record AddressReviewCandidate(string PersonId, string Name, string FoundAddress, string SourceAddress);

public interface IAddressReviewStore
{
    Task EnsureSchemaAsync(CancellationToken cancellationToken);
    Task<List<AddressReviewCandidate>> ListAsync(Guid scenarioId, CancellationToken cancellationToken);
}

public sealed class PostgresAddressReviewStore(NpgsqlDataSource dataSource) : IAddressReviewStore
{
    private const string SchemaSql = """
        CREATE TABLE IF NOT EXISTS scenario_address_reviews (
          scenario_id uuid NOT NULL REFERENCES scenarios(id) ON DELETE CASCADE,
          person_id text NOT NULL,
          found_address text NOT NULL,
          source_address text NOT NULL,
          PRIMARY KEY (scenario_id, person_id)
        );
        """;

    public async Task EnsureSchemaAsync(CancellationToken cancellationToken)
    {
        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        await using var command = new NpgsqlCommand(SchemaSql, connection);
        await command.ExecuteNonQueryAsync(cancellationToken);
    }

    public async Task<List<AddressReviewCandidate>> ListAsync(Guid scenarioId, CancellationToken cancellationToken)
    {
        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        await using var command = new NpgsqlCommand("""
            SELECT review.person_id, COALESCE(person.person_name, review.person_id), review.found_address, review.source_address
            FROM scenario_address_reviews review
            JOIN scenario_persons person ON person.scenario_id = review.scenario_id AND person.person_id = review.person_id
            WHERE review.scenario_id = @scenario
            ORDER BY person.person_name NULLS LAST, review.person_id
            """, connection);
        command.Parameters.AddWithValue("scenario", scenarioId);
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        var reviews = new List<AddressReviewCandidate>();
        while (await reader.ReadAsync(cancellationToken))
            reviews.Add(new AddressReviewCandidate(reader.GetString(0), reader.GetString(1), reader.GetString(2), reader.GetString(3)));
        return reviews;
    }
}

public sealed class InMemoryAddressReviewStore : IAddressReviewStore
{
    public Task EnsureSchemaAsync(CancellationToken cancellationToken) => Task.CompletedTask;
    public Task<List<AddressReviewCandidate>> ListAsync(Guid scenarioId, CancellationToken cancellationToken) => Task.FromResult(new List<AddressReviewCandidate>());
}
