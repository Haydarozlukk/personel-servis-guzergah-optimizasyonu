using Xunit;

public class ScenarioValidatorTests
{
    private static ScenarioInput ValidInput() => new()
    {
        Name = "Ankara sabah",
        Direction = "morning_inbound",
        Workplace = [32.8541, 39.9208],
        ArrivalDeadline = new TimeOnly(8, 30),
        Persons = [new PersonInput("person-001", [32.8597, 39.9334])],
        Vehicles = [new VehicleInput("vehicle-001", 18, [32.8597, 39.9334])],
    };

    [Fact]
    public void ValidInputProducesNoErrors()
    {
        Assert.Empty(ScenarioValidator.Validate(ValidInput()));
    }

    [Fact]
    public void NullInputIsRejected()
    {
        var errors = ScenarioValidator.Validate(null);

        Assert.True(errors.ContainsKey("body"));
    }

    [Fact]
    public void OnlyMorningInboundIsSupported()
    {
        var errors = ScenarioValidator.Validate(ValidInput() with { Direction = "evening_outbound" });

        Assert.Contains("direction", errors.Keys);
    }

    [Fact]
    public void EmptyPersonListIsRejected()
    {
        var errors = ScenarioValidator.Validate(ValidInput() with { Persons = [] });

        Assert.Contains("En az bir personel girilmelidir.", errors["persons"]);
    }

    /// <summary>
    /// Önceki sürümde ikinci hata sözlüğe doğrudan atandığı için birincisini
    /// sessizce eziyordu; her iki mesaj da korunmalıdır.
    /// </summary>
    [Fact]
    public void MultipleErrorsOnTheSameFieldAreAllReported()
    {
        var errors = ScenarioValidator.Validate(ValidInput() with
        {
            Persons =
            [
                new PersonInput("person-001", [32.8597, 39.9334]),
                new PersonInput("person-001", [999.0, 39.9334]),
            ],
        });

        Assert.Contains("Personel kimlikleri benzersiz olmalıdır.", errors["persons"]);
        Assert.Contains(
            "Personel koordinatları [boylam, enlem] sırasında ve geçerli aralıkta olmalıdır.",
            errors["persons"]);
    }

    [Fact]
    public void CapacityBelowOneIsRejected()
    {
        var errors = ScenarioValidator.Validate(ValidInput() with
        {
            Vehicles = [new VehicleInput("vehicle-001", 0, [32.8597, 39.9334])],
        });

        Assert.Contains("Araç kapasitesi en az bir olmalıdır.", errors["vehicles"]);
    }

    [Theory]
    [InlineData(1)]
    [InlineData(24)]
    [InlineData(100)]
    public void AnyPositiveIntegerCapacityIsAccepted(int capacity)
    {
        var errors = ScenarioValidator.Validate(ValidInput() with
        {
            Vehicles = [new VehicleInput("vehicle-001", capacity, [32.8597, 39.9334])],
        });

        Assert.Empty(errors);
    }

    [Theory]
    [InlineData(181.0, 39.9334)]
    [InlineData(-181.0, 39.9334)]
    [InlineData(32.8597, 91.0)]
    [InlineData(32.8597, -91.0)]
    [InlineData(double.NaN, 39.9334)]
    public void OutOfRangeCoordinatesAreRejected(double longitude, double latitude)
    {
        Assert.False(ScenarioValidator.IsCoordinate([longitude, latitude]));
    }

    [Fact]
    public void CoordinateMustHaveExactlyTwoValues()
    {
        Assert.False(ScenarioValidator.IsCoordinate([32.8597]));
        Assert.False(ScenarioValidator.IsCoordinate(null));
    }

    [Fact]
    public void DeadlineSecondsUsesSecondsSinceMidnight()
    {
        Assert.Equal(30600, ValidInput().DeadlineSeconds);
    }
}
