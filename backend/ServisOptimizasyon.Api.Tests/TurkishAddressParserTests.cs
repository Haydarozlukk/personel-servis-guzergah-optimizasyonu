using Xunit;

public class TurkishAddressParserTests
{
    [Theory]
    // Açık işaretli yazımlar.
    [InlineData("3053. Cadde No: 49, Yaşamkent, Ankara", "49")]
    [InlineData("3053. Cadde No.49", "49")]
    [InlineData("Atatürk Bulvarı Numara 121", "121")]
    [InlineData("Kapı No 7/A", "7A")]
    [InlineData("İnönü Cd. No:49/3", "49")]        // /3 dairedir, bina no değil
    [InlineData("no:12 d:5", "12")]                // D:5 yutulmamalı
    [InlineData("No: 49/A, Çankaya", "49A")]
    // İşaretsiz, sondaki çıplak sayı — öncesinde cadde/sokak tokenı şart.
    [InlineData("3053. Cadde 49, Yaşamkent", "49")]
    [InlineData("1816. Sokak 7/B", "7B")]
    [InlineData("Koza 1 Caddesi 15", "15")]
    // Bina no olmayan girdiler.
    [InlineData("3053. Cadde", null)]
    [InlineData("1816. Sokak", null)]              // sıra sayısı, sonda değil
    [InlineData("Koza 1 Caddesi", null)]
    [InlineData("Yaşamkent Mahallesi 3053", null)] // cadde/sokak tokenı yok
    [InlineData("06800 Çankaya", null)]            // posta kodu 5 hane
    [InlineData("Üniversiteler, Bilkent Blv. Bilkent Plaza B1 Block, 06800 Çankaya/Ankara", null)]
    [InlineData("Daire 5", null)]
    [InlineData("Kat 3", null)]
    [InlineData("Çankaya, Ankara", null)]
    [InlineData("", null)]
    public void HouseNumberIsDetectedOnlyForRealBuildingNumbers(string address, string? expected)
    {
        Assert.Equal(expected, TurkishAddressParser.Parse(address).HouseNumber);
    }

    [Theory]
    [InlineData("3053. Cadde No: 49, Yaşamkent, Ankara", "3053. Cadde", "3053. Cadde 49, Yaşamkent, Ankara")]
    [InlineData("3053. Cadde 49, Yaşamkent", "3053. Cadde", "3053. Cadde 49, Yaşamkent")]
    [InlineData("İnönü Cd. No:49/3", "İnönü Cd.", "İnönü Cd. 49")]
    [InlineData("Atatürk Bulvarı Numara 121", "Atatürk Bulvarı", "Atatürk Bulvarı 121")]
    [InlineData("no:12 d:5", "", "12")]
    public void StreetSegmentAndFreeTextDropTheHouseNumberMarker(
        string address, string expectedStreet, string expectedFreeText)
    {
        var parts = TurkishAddressParser.Parse(address);

        Assert.Equal(expectedStreet, parts.StreetSegment);
        Assert.Equal(expectedFreeText, parts.FreeText);
    }

    [Fact]
    public void AddressWithoutHouseNumberKeepsFreeTextIdenticalToInput()
    {
        const string address = "Üniversiteler, Bilkent Bulvarı, Çankaya, Ankara";

        var parts = TurkishAddressParser.Parse(address);

        Assert.Null(parts.HouseNumber);
        Assert.Equal(address, parts.FreeText);
    }

    [Fact]
    public void HouseNumberMarkerIsFoundEvenWhenItFollowsAnEarlierCommaSegment()
    {
        var parts = TurkishAddressParser.Parse("Yaşamkent Mahallesi, 3053. Cadde No:49, Çankaya");

        Assert.Equal("49", parts.HouseNumber);
        // Numara, ait olduğu cadde parçasına geri yazılır; parça sırası korunur.
        Assert.Equal("3053. Cadde", parts.StreetSegment);
        Assert.Equal("Yaşamkent Mahallesi, 3053. Cadde 49, Çankaya", parts.FreeText);
        Assert.Equal("Yaşamkent Mahallesi, 3053. Cadde, Çankaya", parts.WithoutHouseNumber);
    }
}
