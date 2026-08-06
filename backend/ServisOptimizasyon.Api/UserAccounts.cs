using System.Collections.Concurrent;
using System.Security.Claims;
using Microsoft.AspNetCore.Identity;
using Npgsql;

public static class UserRoles
{
    public const string Admin = "admin";
    public const string Expert = "expert";
}

public static class UserStatuses
{
    public const string Pending = "pending";
    public const string Approved = "approved";
    public const string Deleted = "deleted";
}

public sealed record AppUser(
    Guid Id,
    string Email,
    string DisplayName,
    string PasswordHash,
    string Role,
    string Status,
    DateTimeOffset CreatedAt,
    DateTimeOffset UpdatedAt);

public sealed record RegisterRequest(string Email, string DisplayName, string Password);
public sealed record AdminCreateUserRequest(string Email, string DisplayName, string Password, string? Role);
public sealed record LoginRequest(string Email, string Password);
public sealed record UserResult(
    Guid Id,
    string Email,
    string DisplayName,
    string Role,
    string Status,
    DateTimeOffset CreatedAt,
    DateTimeOffset UpdatedAt);

public interface IUserStore
{
    Task EnsureSchemaAsync(CancellationToken cancellationToken);
    Task<AppUser?> FindByEmailAsync(string email, CancellationToken cancellationToken);
    Task<List<AppUser>> ListAsync(CancellationToken cancellationToken);
    Task<bool> CreateAsync(AppUser user, CancellationToken cancellationToken);
    Task<bool> UpsertUserAsync(AppUser user, CancellationToken cancellationToken);
    Task<bool> ApproveAsync(Guid id, CancellationToken cancellationToken);
    Task<bool> SoftDeleteAsync(Guid id, CancellationToken cancellationToken);
}

public sealed class PostgresUserStore(NpgsqlDataSource dataSource) : IUserStore
{
    private const string SchemaSql = """
        CREATE TABLE IF NOT EXISTS app_users (
          id uuid PRIMARY KEY,
          email text NOT NULL,
          normalized_email text NOT NULL UNIQUE,
          display_name text NOT NULL,
          password_hash text NOT NULL,
          role text NOT NULL CHECK (role IN ('admin','expert')),
          status text NOT NULL CHECK (status IN ('pending','approved','deleted')),
          created_at timestamptz NOT NULL DEFAULT now(),
          updated_at timestamptz NOT NULL DEFAULT now()
        );
        CREATE INDEX IF NOT EXISTS ix_app_users_status ON app_users(status, created_at);
        """;

    public async Task EnsureSchemaAsync(CancellationToken cancellationToken)
    {
        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        await using var command = new NpgsqlCommand(SchemaSql, connection);
        await command.ExecuteNonQueryAsync(cancellationToken);
    }

    public async Task<AppUser?> FindByEmailAsync(string email, CancellationToken cancellationToken)
    {
        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        await using var command = new NpgsqlCommand(
            """
            SELECT id, email, display_name, password_hash, role, status, created_at, updated_at
            FROM app_users WHERE normalized_email = @email
            """, connection);
        command.Parameters.AddWithValue("email", Normalize(email));
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        return await reader.ReadAsync(cancellationToken) ? Read(reader) : null;
    }

    public async Task<List<AppUser>> ListAsync(CancellationToken cancellationToken)
    {
        var users = new List<AppUser>();
        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        await using var command = new NpgsqlCommand(
            """
            SELECT id, email, display_name, password_hash, role, status, created_at, updated_at
            FROM app_users WHERE status <> 'deleted'
            ORDER BY CASE status WHEN 'pending' THEN 0 ELSE 1 END, created_at
            """, connection);
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        while (await reader.ReadAsync(cancellationToken))
            users.Add(Read(reader));
        return users;
    }

    public async Task<bool> CreateAsync(AppUser user, CancellationToken cancellationToken)
    {
        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        await using var command = new NpgsqlCommand(
            """
            INSERT INTO app_users
                (id, email, normalized_email, display_name, password_hash, role, status, created_at, updated_at)
            VALUES (@id, @email, @normalized, @name, @hash, @role, @status, @created, @updated)
            ON CONFLICT (normalized_email) DO NOTHING
            """, connection);
        command.Parameters.AddWithValue("id", user.Id);
        command.Parameters.AddWithValue("email", user.Email.Trim());
        command.Parameters.AddWithValue("normalized", Normalize(user.Email));
        command.Parameters.AddWithValue("name", user.DisplayName.Trim());
        command.Parameters.AddWithValue("hash", user.PasswordHash);
        command.Parameters.AddWithValue("role", user.Role);
        command.Parameters.AddWithValue("status", user.Status);
        command.Parameters.AddWithValue("created", user.CreatedAt);
        command.Parameters.AddWithValue("updated", user.UpdatedAt);
        return await command.ExecuteNonQueryAsync(cancellationToken) > 0;
    }

    public async Task<bool> UpsertUserAsync(AppUser user, CancellationToken cancellationToken)
    {
        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        await using var command = new NpgsqlCommand(
            """
            INSERT INTO app_users
                (id, email, normalized_email, display_name, password_hash, role, status, created_at, updated_at)
            VALUES (@id, @email, @normalized, @name, @hash, @role, @status, @created, @updated)
            ON CONFLICT (normalized_email) DO UPDATE SET
                password_hash = EXCLUDED.password_hash,
                role = EXCLUDED.role,
                status = EXCLUDED.status,
                updated_at = now()
            """, connection);
        command.Parameters.AddWithValue("id", user.Id);
        command.Parameters.AddWithValue("email", user.Email.Trim());
        command.Parameters.AddWithValue("normalized", Normalize(user.Email));
        command.Parameters.AddWithValue("name", user.DisplayName.Trim());
        command.Parameters.AddWithValue("hash", user.PasswordHash);
        command.Parameters.AddWithValue("role", user.Role);
        command.Parameters.AddWithValue("status", user.Status);
        command.Parameters.AddWithValue("created", user.CreatedAt);
        command.Parameters.AddWithValue("updated", user.UpdatedAt);
        return await command.ExecuteNonQueryAsync(cancellationToken) > 0;
    }

    public Task<bool> ApproveAsync(Guid id, CancellationToken cancellationToken) =>
        UpdateStatusAsync(id, UserStatuses.Approved, excludeAdmin: false, cancellationToken);

    public Task<bool> SoftDeleteAsync(Guid id, CancellationToken cancellationToken) =>
        UpdateStatusAsync(id, UserStatuses.Deleted, excludeAdmin: false, cancellationToken);

    private async Task<bool> UpdateStatusAsync(
        Guid id,
        string status,
        bool excludeAdmin,
        CancellationToken cancellationToken)
    {
        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        await using var command = new NpgsqlCommand(
            $"UPDATE app_users SET status = @status, updated_at = now() WHERE id = @id{(excludeAdmin ? " AND role <> 'admin'" : "")}",
            connection);
        command.Parameters.AddWithValue("id", id);
        command.Parameters.AddWithValue("status", status);
        return await command.ExecuteNonQueryAsync(cancellationToken) == 1;
    }

    private static AppUser Read(NpgsqlDataReader reader) => new(
        reader.GetGuid(0), reader.GetString(1), reader.GetString(2), reader.GetString(3),
        reader.GetString(4), reader.GetString(5), reader.GetFieldValue<DateTimeOffset>(6),
        reader.GetFieldValue<DateTimeOffset>(7));

    private static string Normalize(string email) => email.Trim().ToUpperInvariant();
}

public sealed class InMemoryUserStore : IUserStore
{
    private readonly ConcurrentDictionary<string, AppUser> _users = new(StringComparer.OrdinalIgnoreCase);

    public Task EnsureSchemaAsync(CancellationToken cancellationToken) => Task.CompletedTask;
    public Task<AppUser?> FindByEmailAsync(string email, CancellationToken cancellationToken) =>
        Task.FromResult(_users.TryGetValue(email.Trim(), out var user) ? user : null);
    public Task<List<AppUser>> ListAsync(CancellationToken cancellationToken) =>
        Task.FromResult(_users.Values.Where(user => user.Status != UserStatuses.Deleted).OrderBy(user => user.CreatedAt).ToList());
    public Task<bool> CreateAsync(AppUser user, CancellationToken cancellationToken) =>
        Task.FromResult(_users.TryAdd(user.Email.Trim(), user));
    public Task<bool> UpsertUserAsync(AppUser user, CancellationToken cancellationToken)
    {
        _users[user.Email.Trim()] = user;
        return Task.FromResult(true);
    }
    public Task<bool> ApproveAsync(Guid id, CancellationToken cancellationToken) => Update(id, UserStatuses.Approved, false);
    public Task<bool> SoftDeleteAsync(Guid id, CancellationToken cancellationToken) => Update(id, UserStatuses.Deleted, false);

    private Task<bool> Update(Guid id, string status, bool excludeAdmin)
    {
        var pair = _users.FirstOrDefault(item => item.Value.Id == id && (!excludeAdmin || item.Value.Role != UserRoles.Admin));
        if (pair.Value is null) return Task.FromResult(false);
        _users[pair.Key] = pair.Value with { Status = status, UpdatedAt = DateTimeOffset.UtcNow };
        return Task.FromResult(true);
    }
}

public static class UserAccountHelpers
{
    public static UserResult ToResult(this AppUser user) => new(
        user.Id, user.Email, user.DisplayName, user.Role, user.Status, user.CreatedAt, user.UpdatedAt);

    public static ClaimsPrincipal CreatePrincipal(AppUser user)
    {
        var identity = new ClaimsIdentity("ApplicationCookie");
        identity.AddClaim(new Claim(ClaimTypes.NameIdentifier, user.Id.ToString()));
        identity.AddClaim(new Claim(ClaimTypes.Email, user.Email));
        identity.AddClaim(new Claim(ClaimTypes.Name, user.DisplayName));
        identity.AddClaim(new Claim(ClaimTypes.Role, user.Role));
        return new ClaimsPrincipal(identity);
    }

    public static Dictionary<string, string[]> Validate(RegisterRequest request)
    {
        var errors = new Dictionary<string, string[]>();
        if (string.IsNullOrWhiteSpace(request.DisplayName)) errors["displayName"] = ["Ad soyad zorunludur."];
        if (!System.Net.Mail.MailAddress.TryCreate(request.Email, out _)) errors["email"] = ["Geçerli bir e-posta girilmelidir."];
        if (request.Password?.Length < 10) errors["password"] = ["Parola en az 10 karakter olmalıdır."];
        return errors;
    }
}
