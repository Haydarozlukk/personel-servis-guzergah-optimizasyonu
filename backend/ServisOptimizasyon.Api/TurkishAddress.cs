using System.Text.RegularExpressions;

/// <summary>
/// Bir serbest metin adresinden bina numarasını ayırır.
/// </summary>
/// <param name="HouseNumber">"49", "49A" gibi normalize edilmiş bina no; bulunamazsa null.</param>
/// <param name="StreetSegment">Bina no'nun ait olduğu adres parçası, numarası
/// çıkarılmış hâliyle; örn. "3053. Cadde". Yapılandırılmış aramada
/// <c>street=&lt;no&gt; &lt;StreetSegment&gt;</c> olarak kullanılır.</param>
/// <param name="WithoutHouseNumber">Adresin bina no tamamen çıkarılmış hâli; sıra korunur.</param>
/// <param name="FreeText">Nominatim'e gönderilecek hâli: "No:"/"Numara" eki ve daire
/// kuyruğu temizlenmiş, bina no ait olduğu cadde parçasının sonunda sade sayı olarak duran adres.</param>
public sealed record AddressQueryParts(
    string? HouseNumber,
    string StreetSegment,
    string WithoutHouseNumber,
    string FreeText);

/// <summary>
/// Türkçe adres yazımında bina numarası "3053. Cadde No: 49" gibi bir ekle
/// belirtiliyor. Nominatim'in tokenizer'ı için "No" eşleşmeyen bir kelime tokenı;
/// yerel Nominatim'de ölçtüğümüz kadarıyla aynı adres "No:" ile cadde seviyesinde,
/// "No:" olmadan bina seviyesinde sonuç veriyor. Bu yüzden numarayı ayırıp
/// sorguyu sadeleştiriyoruz.
/// </summary>
public static class TurkishAddressParser
{
    /// <summary>
    /// "No: 49", "No.49", "Numara 121", "Kapı No 7/A" gibi açık işaretli yazımlar.
    /// <c>sfx</c> grubundaki <c>(?:/\s*|-)?</c> harften önce boşluğa **izin vermez**;
    /// "No:12 D:5" girdisinde 12'den sonra boşluk geldiği için "D" blok harfi sanılmaz.
    /// <c>apt</c> ve <c>unit</c> grupları yalnızca tüketilip atılmak için var, yoksa
    /// eşleşme silindiğinde caddede sarkan "/3" ya da "D:5" kalır.
    /// </summary>
    private static readonly Regex ExplicitHouseNumber = new(
        @"\b(?:kap[ıi]\s*)?(?:no|numara|nu)\b\s*[:.\-]?\s*"
        + @"(?<num>\d{1,4})"
        + @"(?<sfx>(?:/\s*|-)?(?<letter>\p{L})(?!\p{L}))?"
        + @"(?<apt>\s*/\s*\d{1,3}\b)?"
        + @"(?<unit>\s*[,/]?\s*\b(?:d|daire|kat|blok)\b\s*[:.\-]?\s*\d{1,3}\b)?",
        RegexOptions.IgnoreCase | RegexOptions.CultureInvariant | RegexOptions.Compiled);

    /// <summary>
    /// İşaretsiz yazımda ("3053. Cadde 49") numarayı ancak öncesinde bir cadde/sokak
    /// tokenı varsa kabul ederiz; aksi hâlde "Yaşamkent Mahallesi 3053" gibi sayıyla
    /// adlandırılmış bir yolun adını bina no sanardık.
    /// </summary>
    private static readonly Regex StreetTypeToken = new(
        @"\b(?:cad(?:de(?:si)?)?|cd|sok(?:ak|ağı|agi)?|sk|bul(?:var[ıi])?|blv|blvr)\b\.?",
        RegexOptions.IgnoreCase | RegexOptions.CultureInvariant | RegexOptions.Compiled);

    private static readonly Regex TrailingHouseNumber = new(
        @"(?<!\d)(?<num>\d{1,4})"
        + @"(?<sfx>(?:/\s*)?(?<letter>\p{L})(?!\p{L}))?"
        + @"(?<apt>\s*/\s*\d{1,3})?\s*$",
        RegexOptions.IgnoreCase | RegexOptions.CultureInvariant | RegexOptions.Compiled);

    /// <summary>"Daire 5" / "Kat 3" gibi birim numaralarını bina no sanmamak için.</summary>
    private static readonly Regex UnitMarkerSuffix = new(
        @"\b(?:d|daire|kat|blok)\s*[:.\-]?\s*$",
        RegexOptions.IgnoreCase | RegexOptions.CultureInvariant | RegexOptions.Compiled);

    public static AddressQueryParts Parse(string address)
    {
        var value = (address ?? string.Empty).Trim();
        if (value.Length == 0)
            return new AddressQueryParts(null, string.Empty, string.Empty, string.Empty);

        var segments = value.Split(',').Select(segment => segment.Trim()).ToList();

        // Bina no adresin herhangi bir parçasında olabilir ("Yaşamkent Mah., 3053.
        // Cadde No:49, Çankaya"); numarayı bulduğumuz parçaya geri yazabilmek için
        // parça parça arıyoruz.
        for (var index = 0; index < segments.Count; index++)
        {
            var match = ExplicitHouseNumber.Match(segments[index]);
            if (!match.Success)
                continue;

            var street = Collapse(segments[index].Remove(match.Index, match.Length));
            return Build(segments, index, street, NormalizeHouseNumber(match));
        }

        // İşaretsiz yazımı yalnızca ilk parçada arıyoruz; sonraki parçalar mahalle/
        // ilçe/posta kodu olup sayıyla bitebiliyor.
        var trailing = TrailingHouseNumber.Match(segments[0]);
        if (trailing.Success)
        {
            var before = segments[0][..trailing.Index];
            if (StreetTypeToken.IsMatch(before) && !UnitMarkerSuffix.IsMatch(before))
                return Build(segments, 0, Collapse(before), NormalizeHouseNumber(trailing));
        }

        return new AddressQueryParts(null, segments[0], value, value);
    }

    private static AddressQueryParts Build(
        List<string> segments,
        int streetIndex,
        string streetSegment,
        string houseNumber)
    {
        var withoutNumber = Rejoin(segments, streetIndex, streetSegment);
        var freeText = Rejoin(segments, streetIndex, Join(streetSegment, houseNumber, " "));
        return new AddressQueryParts(houseNumber, streetSegment, withoutNumber, freeText);
    }

    private static string Rejoin(List<string> segments, int replaceIndex, string replacement) =>
        string.Join(", ", segments
            .Select((segment, index) => index == replaceIndex ? replacement : segment)
            .Where(segment => !string.IsNullOrWhiteSpace(segment)));

    /// <summary>"49" + "/A" → "49A"; "49/3" içindeki /3 dairedir, atılır.</summary>
    private static string NormalizeHouseNumber(Match match) =>
        (match.Groups["num"].Value + match.Groups["letter"].Value).ToUpperInvariant();

    private static string Collapse(string value)
    {
        var collapsed = Regex.Replace(value, @"\s+", " ");
        return collapsed.Trim(' ', ',', '-', '/');
    }

    private static string Join(string left, string right, string separator) =>
        (left.Length, right.Length) switch
        {
            (0, _) => right,
            (_, 0) => left,
            _ => left + separator + right,
        };
}
