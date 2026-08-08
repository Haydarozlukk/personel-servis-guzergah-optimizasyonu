# OSRM verisi

OSRM'nin `car` ve `foot` MLD verileri Compose tarafından otomatik hazırlanır.
Manuel PBF indirme veya repo içine `.osrm` dosyası yerleştirme gerekmez.

Veri akışı:

1. `map-prepare`, Geofabrik Türkiye PBF'sini indirir ve Osmium ile Ankara kapsamına keser.
2. Kırpılmış `/map/ankara.osm.pbf`, `map-source` named volume'unda tutulur.
3. `map-prepare`, aynı PBF'ten halka kapalı alanları maskelenmiş
   `/map/ankara-routing.osm.pbf` kopyasını üretir (aşağıya bakınız).
4. `osrm-prepare`, maskelenmiş PBF için sırasıyla `osrm-extract`, `osrm-partition`
   ve `osrm-customize` çalıştırır.
5. `foot.osrm*` ve `car.osrm*` dosyaları `osrm-data` named volume'una yazılır.
6. `osrm-foot` ve `osrm-car`, prepare servisi başarıyla tamamlandıktan sonra başlar.

Hazırlık ve runtime servisleri aynı sabit OSRM image digest'inden oluştuğu için
ön işleme formatı ile `osrm-routed` sürümü uyumludur. PBF checksum'ı ve zorunlu
MLD çıktıları geçerliyse sonraki açılışlarda ön işleme atlanır.

Tam routing stack'ini başlatmak için:

```bash
docker compose --profile routing up --build
```

Compose içinde `osrm-foot` hostta `5001`, `osrm-car` ise `5002` portunda
yayımlanır. Servisler kendi aralarında container portu `5000` üzerinden konuşur.

## Halka kapalı alanlar

Kampüs ve askeri bölge gibi servis araçlarına kapalı alanların sınırları
`infrastructure/restricted-areas.geojson` dosyasında tutulur.
`infrastructure/nominatim/mask-restricted-areas.py`, bu poligonların içinde kalan
yolları `access=no` ile işaretler; OSRM'nin varsayılan `car`/`foot` profilleri bu
yolları graftan düşürdüğü için rotalar artık bu alanlardan geçmez.

Maskeleme yalnızca rotalama kopyasına uygulanır. Nominatim ham `ankara.osm.pbf`
dosyasını kullanmaya devam eder, böylece bu kurumlar adres aramasında bulunabilir.

Kural iki kademelidir:

1. Düğümlerinin %90'ı bir poligonun içinde kalan yol, sınıfından bağımsız
   maskelenir. Kampüs iç yolları uçlarıyla kapıya bağlandığı için tam kapsama
   aranmaz; OSM bu yolları kampüs içinde bile `tertiary` veya `access=yes`
   etiketleyebildiğinden sınıf ayrımı bu kademede yapılmaz.
2. Bu oranın altında kalıp alana yalnızca uğrayan ana arterler
   (`motorway`…`tertiary` ve `_link` türevleri) korunur; kesilmeleri şehir
   trafiğini bozar.

Sınırı gereğinden geniş çizilmiş bir yerleşke kamu caddesini içine alabilir.
Böyle durumlar için `ALWAYS_OPEN_STREET_NAMES` istisna listesi vardır; script
her çalıştığında ana arter sınıfında maskelenen isimli yolları "DENETİM" başlığı
altında listeler, yeni bir hatalı yakalama buradan görülür.

Yeni bir alan eklemek için GeoJSON'a aynı yapıda bir `Feature` ekleyip harita
verisini yenilemek yeterlidir. Listeyi OSM'den toplu üretmek için
`extract-restricted-areas.py` kullanılır.

Backend aynı dosyayı okur ve rota geometrisinin alan içinde 75 m'den uzun
kalması hâlinde güzergâhı `restrictedAreasCrossed` ile işaretler. Eşik, sınır
çizgisi kamu yolunun üzerinden geçtiğinde teğet güzergâhların yanlış uyarı
üretmesini engeller.

## Harita verisini yenileme

```bash
docker compose down -v
docker compose --profile routing up --build
```

`down -v`, PostgreSQL dahil projeye ait bütün named volume'ları siler. Eski
`infrastructure/osrm/data` klasörü yeni akışta kullanılmaz; mevcut yerel dosyalar
otomatik olarak silinmez.

## Gerçek yaya entegrasyon testi

```powershell
$env:RUN_OSRM_INTEGRATION = "1"
$env:OSRM_FOOT_URL = "http://localhost:5001"
.\.venv\Scripts\python.exe -m pytest tests\test_osrm_integration.py -q
```
