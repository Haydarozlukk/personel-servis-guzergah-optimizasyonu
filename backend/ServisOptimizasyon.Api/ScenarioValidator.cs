/// <summary>
/// Senaryo girdisinin iş kurallarını doğrular. `required` anahtar sözcüğü eksik
/// alanı yakalar; burada ayrıca açıkça <c>null</c> gönderilen ve iş kuralına
/// aykırı değerler ele alınır.
/// </summary>
public static class ScenarioValidator
{
    public static Dictionary<string, string[]> Validate(ScenarioInput? input)
    {
        var errors = new ErrorBag();

        if (input is null)
        {
            errors.Add("body", "İstek gövdesi boş olamaz.");
            return errors.Build();
        }

        if (input.Direction != "morning_inbound")
            errors.Add("direction", "Yalnızca morning_inbound desteklenir.");

        if (string.IsNullOrWhiteSpace(input.Name))
            errors.Add("name", "Senaryo adı boş olamaz.");

        if (!IsCoordinate(input.Workplace))
            errors.Add("workplace", "İşyeri koordinatı [boylam, enlem] sırasında ve geçerli aralıkta olmalıdır.");

        ValidatePersons(input.Persons, errors);
        ValidateVehicles(input.Vehicles, errors);

        return errors.Build();
    }

    public static Dictionary<string, string[]> ValidateVehiclesOnly(List<VehicleInput>? vehicles)
    {
        var errors = new ErrorBag();
        ValidateVehicles(vehicles, errors);
        return errors.Build();
    }

    private static void ValidatePersons(List<PersonInput>? persons, ErrorBag errors)
    {
        if (persons is not { Count: > 0 })
        {
            errors.Add("persons", "En az bir personel girilmelidir.");
            return;
        }

        if (persons.Any(person => string.IsNullOrWhiteSpace(person.Id)))
            errors.Add("persons", "Personel kimliği boş olamaz.");

        if (persons.Select(person => person.Id).Distinct(StringComparer.Ordinal).Count() != persons.Count)
            errors.Add("persons", "Personel kimlikleri benzersiz olmalıdır.");

        if (persons.Any(person => !IsCoordinate(person.Location)))
            errors.Add("persons", "Personel koordinatları [boylam, enlem] sırasında ve geçerli aralıkta olmalıdır.");
    }

    private static void ValidateVehicles(List<VehicleInput>? vehicles, ErrorBag errors)
    {
        if (vehicles is not { Count: > 0 })
        {
            errors.Add("vehicles", "En az bir araç girilmelidir.");
            return;
        }

        if (vehicles.Any(vehicle => string.IsNullOrWhiteSpace(vehicle.Id)))
            errors.Add("vehicles", "Araç kimliği boş olamaz.");

        if (vehicles.Select(vehicle => vehicle.Id).Distinct(StringComparer.Ordinal).Count() != vehicles.Count)
            errors.Add("vehicles", "Araç kimlikleri benzersiz olmalıdır.");

        if (vehicles.Any(vehicle => vehicle.Capacity < 1))
            errors.Add("vehicles", "Araç kapasitesi en az bir olmalıdır.");

        if (vehicles.Any(vehicle => vehicle.Capacity is not (18 or 30 or 46)))
            errors.Add("vehicles", "Araç kapasitesi yalnızca 18, 30 veya 46 olabilir.");

        if (vehicles.Any(vehicle => vehicle.ReservedSeats < 0 || vehicle.ReservedSeats >= vehicle.Capacity))
            errors.Add("vehicles", "Rezerv boş koltuk sayısı sıfırdan küçük ve araç kapasitesinden büyük/eşit olamaz.");

        if (vehicles.Any(vehicle => vehicle.Start is not null && !IsCoordinate(vehicle.Start)))
            errors.Add("vehicles", "Verilen araç başlangıç koordinatları [boylam, enlem] sırasında ve geçerli aralıkta olmalıdır.");
    }

    public static bool IsCoordinate(double[]? coordinate) =>
        coordinate is { Length: 2 }
        && double.IsFinite(coordinate[0])
        && double.IsFinite(coordinate[1])
        && coordinate[0] is >= -180 and <= 180
        && coordinate[1] is >= -90 and <= 90;

    /// <summary>
    /// Aynı alan için birden fazla hata biriktirir. Doğrudan sözlüğe atama
    /// yapılırsa önceki mesaj sessizce eziliyordu.
    /// </summary>
    private sealed class ErrorBag
    {
        private readonly Dictionary<string, List<string>> _errors = new(StringComparer.Ordinal);

        public void Add(string key, string message)
        {
            if (!_errors.TryGetValue(key, out var messages))
            {
                messages = [];
                _errors[key] = messages;
            }

            messages.Add(message);
        }

        public Dictionary<string, string[]> Build() =>
            _errors.ToDictionary(entry => entry.Key, entry => entry.Value.ToArray(), StringComparer.Ordinal);
    }
}
