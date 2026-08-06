using Xunit;

public class FleetPlannerTests
{
    [Theory]
    [InlineData(18, 1, 18)]
    [InlineData(19, 1, 30)]
    [InlineData(31, 1, 46)]
    [InlineData(50, 2, 60)]
    [InlineData(500, 11, 506)]
    public void CreatesSmallestFleetThenSmallestSeatSurplus(int persons, int count, int capacity)
    {
        var vehicles = FleetPlanner.Create(persons, [32.8, 39.9]);

        Assert.Equal(count, vehicles.Count);
        Assert.Equal(capacity, vehicles.Sum(vehicle => vehicle.Capacity));
        Assert.All(vehicles, vehicle => Assert.Contains(vehicle.Capacity, FleetPlanner.SupportedCapacities));
    }
}
