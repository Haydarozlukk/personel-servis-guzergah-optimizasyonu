using Xunit;

public class FleetPlannerTests
{
    [Theory]
    [InlineData(1)]
    [InlineData(18)]
    [InlineData(474)]
    [InlineData(5000)]
    public void CreatesFleetCappedAtMaxVehicleCountWithMixedCapacities(int persons)
    {
        var vehicles = FleetPlanner.Create(persons, [32.8, 39.9]);

        Assert.Equal(FleetPlanner.MaxVehicleCount, vehicles.Count);
        Assert.All(vehicles, vehicle => Assert.Contains(vehicle.Capacity, FleetPlanner.SupportedCapacities));
    }

    [Fact]
    public void RespectsSmallerFixedVehicleCount()
    {
        var vehicles = FleetPlanner.Create(50, [32.8, 39.9], fixedVehicleCount: 10);

        Assert.Equal(10, vehicles.Count);
    }

    [Fact]
    public void ClampsFixedVehicleCountToMax()
    {
        var vehicles = FleetPlanner.Create(500, [32.8, 39.9], fixedVehicleCount: 100);

        Assert.Equal(FleetPlanner.MaxVehicleCount, vehicles.Count);
    }
}
