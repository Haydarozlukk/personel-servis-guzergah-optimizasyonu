using System.Threading.Channels;

public sealed record ScenarioJob(Guid ScenarioId);

/// <summary>
/// Senaryo işlerinin arka plan kuyruğu. İstek/cevap döngüsü optimizasyonu
/// beklemez; `202 Accepted` gerçek anlamını kazanır.
/// </summary>
public sealed class ScenarioQueue
{
    private readonly Channel<ScenarioJob> _channel =
        Channel.CreateBounded<ScenarioJob>(new BoundedChannelOptions(1000)
        {
            FullMode = BoundedChannelFullMode.Wait,
        });

    public ValueTask EnqueueAsync(ScenarioJob job, CancellationToken cancellationToken) =>
        _channel.Writer.WriteAsync(job, cancellationToken);

    public IAsyncEnumerable<ScenarioJob> ReadAllAsync(CancellationToken cancellationToken) =>
        _channel.Reader.ReadAllAsync(cancellationToken);
}

public sealed class ScenarioWorker(
    ScenarioQueue queue,
    IServiceScopeFactory scopeFactory,
    ILogger<ScenarioWorker> logger) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        await foreach (var job in queue.ReadAllAsync(stoppingToken))
        {
            // İstek iptal edilse bile iş tamamlanır; yalnızca uygulama kapanışı durdurur.
            await ProcessAsync(job, stoppingToken);
        }
    }

    private async Task ProcessAsync(ScenarioJob job, CancellationToken cancellationToken)
    {
        using var scope = scopeFactory.CreateScope();
        var store = scope.ServiceProvider.GetRequiredService<IScenarioStore>();
        var orchestrator = scope.ServiceProvider.GetRequiredService<ScenarioOrchestrator>();

        using var logScope = logger.BeginScope("Senaryo {ScenarioId}", job.ScenarioId);

        try
        {
            var input = await store.TryGetInputAsync(job.ScenarioId, cancellationToken);

            if (input is null)
            {
                logger.LogWarning("Kuyruktaki senaryo veritabanında bulunamadı, atlanıyor.");
                return;
            }

            await store.SetStatusAsync(job.ScenarioId, ScenarioStatus.Running, null, cancellationToken);

            var computation = await orchestrator.OptimizeAsync(input, cancellationToken);

            await store.SaveComputationAsync(job.ScenarioId, computation, cancellationToken);
            logger.LogInformation("Senaryo tamamlandı.");
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
            logger.LogWarning("Uygulama kapanışı nedeniyle senaryo yarıda kaldı.");
            throw;
        }
        catch (Exception exception)
        {
            logger.LogError(exception, "Senaryo başarısız oldu.");

            try
            {
                await store.SetStatusAsync(
                    job.ScenarioId,
                    ScenarioStatus.Failed,
                    exception.Message,
                    CancellationToken.None);
            }
            catch (Exception storeException)
            {
                logger.LogError(storeException, "Başarısız durumu kalıcılaştırılamadı.");
            }
        }
    }

}
