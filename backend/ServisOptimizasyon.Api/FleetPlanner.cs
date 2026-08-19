public static class FleetPlanner
{
    // Gercek filo bu dort kapasiteden olusuyor (40/28/18/16 kisilik araclar);
    // esit boyutta degil, coklu araclar sirayla dagitilir ki VROOM koltuk
    // sinirindan once cogunlukla rota suresi/mesafesiyle sinirlansin.
    public static readonly int[] SupportedCapacities = [40, 28, 18, 16];

    // Gercek filoda en fazla 45 arac var; bundan fazlasi dispatch edilemez.
    public const int MaxVehicleCount = 45;

    /// <summary>
    /// Kapasiteleri <see cref="SupportedCapacities"/> arasinda donen, en fazla
    /// <see cref="MaxVehicleCount"/> araclik bir baslangic filosu uretir. Araclar
    /// ilk optimizasyonda acik rota olarak cozulecegi icin baslangic koordinati
    /// yalnizca eski sozlesmeyle uyumluluk amaciyla varis noktasi olarak tutulur.
    /// </summary>
    public static List<VehicleInput> Create(int personCount, double[] destination, int? fixedVehicleCount = null)
    {
        if (personCount < 1) throw new ArgumentOutOfRangeException(nameof(personCount));

        var vehicleCount = fixedVehicleCount is > 0
            ? Math.Min(fixedVehicleCount.Value, MaxVehicleCount)
            : MaxVehicleCount;

        return Enumerable.Range(1, vehicleCount)
            .Select(index => new VehicleInput(
                $"Servis-{index:D3}",
                SupportedCapacities[(index - 1) % SupportedCapacities.Length],
                destination))
            .ToList();
    }
}
