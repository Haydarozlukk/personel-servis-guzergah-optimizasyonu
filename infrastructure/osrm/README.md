# OSRM verisi

OSRM'nin `car` ve `foot` MLD verileri Compose tarafından otomatik hazırlanır.
Manuel PBF indirme veya repo içine `.osrm` dosyası yerleştirme gerekmez.

Veri akışı:

1. `map-prepare`, Geofabrik Türkiye PBF'sini indirir ve Osmium ile Ankara kapsamına keser.
2. Kırpılmış `/map/ankara.osm.pbf`, `map-source` named volume'unda tutulur.
3. `osrm-prepare`, bu PBF için sırasıyla `osrm-extract`, `osrm-partition` ve
   `osrm-customize` çalıştırır.
4. `foot.osrm*` ve `car.osrm*` dosyaları `osrm-data` named volume'una yazılır.
5. `osrm-foot` ve `osrm-car`, prepare servisi başarıyla tamamlandıktan sonra başlar.

Hazırlık ve runtime servisleri aynı sabit OSRM image digest'inden oluştuğu için
ön işleme formatı ile `osrm-routed` sürümü uyumludur. PBF checksum'ı ve zorunlu
MLD çıktıları geçerliyse sonraki açılışlarda ön işleme atlanır.

Tam routing stack'ini başlatmak için:

```bash
docker compose --profile routing up --build
```

Compose içinde `osrm-foot` hostta `5001`, `osrm-car` ise `5002` portunda
yayımlanır. Servisler kendi aralarında container portu `5000` üzerinden konuşur.

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
