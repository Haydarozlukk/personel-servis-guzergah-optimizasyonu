public static class ManualPlanValidator
{
    public static Dictionary<string, string[]> Validate(ScenarioResult? plan)
    {
        var errors = new Dictionary<string, List<string>>(StringComparer.Ordinal);
        void Add(string key, string message)
        {
            if (!errors.TryGetValue(key, out var list)) errors[key] = list = [];
            list.Add(message);
        }

        if (plan is null)
        {
            Add("plan", "Plan boş olamaz.");
            return Build(errors);
        }

        foreach (var pair in ScenarioValidator.ValidateVehiclesOnly(plan.Vehicles))
            foreach (var message in pair.Value) Add(pair.Key, message);

        if (!ScenarioValidator.IsCoordinate(plan.Workplace)) Add("workplace", "Varış koordinatı geçersiz.");
        var personIds = plan.Persons.Select(person => person.Id).ToList();
        if (personIds.Any(string.IsNullOrWhiteSpace) || personIds.Distinct(StringComparer.Ordinal).Count() != personIds.Count)
            Add("persons", "Yolcu kimlikleri dolu ve benzersiz olmalıdır.");
        if (plan.Persons.Any(person => !ScenarioValidator.IsCoordinate(person.Location)))
            Add("persons", "Yolcu koordinatları geçersiz.");

        var knownPersons = personIds.ToHashSet(StringComparer.Ordinal);
        var knownVehicles = plan.Vehicles.Select(vehicle => vehicle.Id).ToHashSet(StringComparer.Ordinal);
        var stopIds = plan.Stops.Select(stop => stop.Id).ToList();
        var knownStops = stopIds.ToHashSet(StringComparer.Ordinal);
        if (knownStops.Count != stopIds.Count) Add("stops", "Durak kimlikleri benzersiz olmalıdır.");
        if (plan.Stops.Any(stop => !ScenarioValidator.IsCoordinate(stop.Location))) Add("stops", "Durak koordinatları geçersiz.");

        var assigned = plan.Stops.SelectMany(stop => stop.AssignedPersonIds).ToList();
        if (assigned.Any(id => !knownPersons.Contains(id))) Add("stops", "Duraklarda bilinmeyen yolcu bulunuyor.");
        if (assigned.Distinct(StringComparer.Ordinal).Count() != assigned.Count) Add("stops", "Bir yolcu birden fazla durağa atanamaz.");

        if (plan.Routes.Any(route => !knownVehicles.Contains(route.VehicleId))) Add("routes", "Bilinmeyen araca ait rota bulunuyor.");
        if (plan.Routes.Select(route => route.VehicleId).Distinct(StringComparer.Ordinal).Count() != plan.Routes.Count)
            Add("routes", "Bir araç için birden fazla rota tanımlanamaz.");
        var routedStops = plan.Routes.SelectMany(route => route.StopIds).ToList();
        if (routedStops.Any(id => !knownStops.Contains(id))) Add("routes", "Rotada bilinmeyen durak bulunuyor.");
        if (routedStops.Distinct(StringComparer.Ordinal).Count() != routedStops.Count) Add("routes", "Bir durak birden fazla serviste olamaz.");
        var routedStopSet = routedStops.ToHashSet(StringComparer.Ordinal);
        if (plan.Stops.Any(stop => stop.AssignedPersonIds.Count > 0 && !routedStopSet.Contains(stop.Id)))
            Add("routes", "Yolcu atanmış her durak bir servis rotasında bulunmalıdır.");

        var stopById = plan.Stops.GroupBy(stop => stop.Id, StringComparer.Ordinal)
            .ToDictionary(group => group.Key, group => group.First(), StringComparer.Ordinal);
        var vehicleById = plan.Vehicles.GroupBy(vehicle => vehicle.Id, StringComparer.Ordinal)
            .ToDictionary(group => group.Key, group => group.First(), StringComparer.Ordinal);
        foreach (var route in plan.Routes.Where(route => vehicleById.ContainsKey(route.VehicleId)))
        {
            var actualLoad = route.StopIds
                .Where(stopById.ContainsKey)
                .Sum(stopId => stopById[stopId].AssignedPersonIds.Count);
            var vehicle = vehicleById[route.VehicleId];
            if (actualLoad > vehicle.EffectiveCapacity)
                Add("routes", $"{vehicle.Id} servisi etkin kapasitesini aşıyor ({actualLoad}/{vehicle.EffectiveCapacity}).");
            if (route.Load != actualLoad)
                Add("routes", $"{vehicle.Id} servisinin kayıtlı yükü gerçek yolcu sayısıyla eşleşmiyor.");
        }

        var unassigned = plan.UnassignedPersonIds.ToHashSet(StringComparer.Ordinal);
        if (unassigned.Count != plan.UnassignedPersonIds.Count)
            Add("unassignedPersonIds", "Atanmamış yolcu kimlikleri benzersiz olmalıdır.");
        if (unassigned.Any(id => !knownPersons.Contains(id))) Add("unassignedPersonIds", "Atanmamış listesinde bilinmeyen yolcu bulunuyor.");
        if (unassigned.Overlaps(assigned)) Add("unassignedPersonIds", "Bir yolcu hem serviste hem atanmamış listesinde olamaz.");
        var accountedFor = assigned.Concat(unassigned).ToHashSet(StringComparer.Ordinal);
        if (!accountedFor.SetEquals(knownPersons))
            Add("persons", "Her yolcu bir servise atanmış veya servis atanmamış listesinde olmalıdır.");

        var reasonIds = plan.UnassignedPersons.Select(person => person.Id).ToHashSet(StringComparer.Ordinal);
        if (!reasonIds.SetEquals(unassigned))
            Add("unassignedPersons", "Atanmamış yolcu detayları kimlik listesiyle eşleşmelidir.");

        return Build(errors);
    }

    private static Dictionary<string, string[]> Build(Dictionary<string, List<string>> errors) =>
        errors.ToDictionary(pair => pair.Key, pair => pair.Value.ToArray(), StringComparer.Ordinal);
}
