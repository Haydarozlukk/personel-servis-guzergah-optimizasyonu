public static class FleetPlanner
{
    public static readonly int[] SupportedCapacities = [18, 30, 46];

    /// <summary>
    /// Önce araç sayısını, eşit araç sayısında boş koltuk miktarını azaltan
    /// deterministik başlangıç filosu üretir. Araçlar ilk optimizasyonda açık
    /// rota olarak çözüleceği için başlangıç koordinatı yalnızca eski sözleşmeyle
    /// uyumluluk amacıyla varış noktası olarak tutulur.
    /// </summary>
    public static List<VehicleInput> Create(int personCount, double[] destination)
    {
        if (personCount < 1) throw new ArgumentOutOfRangeException(nameof(personCount));

        var maxVehicles = (int)Math.Ceiling(personCount / (double)SupportedCapacities.Min());
        (int VehicleCount, int TotalCapacity, int[] Capacities)? best = null;

        for (var count18 = 0; count18 <= maxVehicles; count18++)
        for (var count30 = 0; count30 <= maxVehicles - count18; count30++)
        for (var count46 = 0; count46 <= maxVehicles - count18 - count30; count46++)
        {
            var vehicleCount = count18 + count30 + count46;
            if (vehicleCount == 0) continue;
            var totalCapacity = (count18 * 18) + (count30 * 30) + (count46 * 46);
            if (totalCapacity < personCount) continue;

            var capacities = Enumerable.Repeat(46, count46)
                .Concat(Enumerable.Repeat(30, count30))
                .Concat(Enumerable.Repeat(18, count18))
                .ToArray();
            if (best is null
                || vehicleCount < best.Value.VehicleCount
                || (vehicleCount == best.Value.VehicleCount && totalCapacity < best.Value.TotalCapacity))
            {
                best = (vehicleCount, totalCapacity, capacities);
            }
        }

        var selected = best?.Capacities
            ?? throw new InvalidOperationException("Başlangıç filosu oluşturulamadı.");
        return selected.Select((capacity, index) =>
            new VehicleInput($"Servis-{index + 1:D3}", capacity, destination)).ToList();
    }
}
