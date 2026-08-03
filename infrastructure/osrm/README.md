# OSRM verisi

OSRM'nin `car` ve `foot` profilleri ön işleme anında oluşur. Ankara OSM PBF girdisinden iki ayrı çıktı üretin ve sonuçları `data/car.osrm*` ile `data/foot.osrm*` olarak yerleştirin.

Bu büyük veri dosyaları Git'e alınmaz. Compose içinde routing profili açıldığında `osrm-car` ve `osrm-foot` servisleri çalışır.

PoC için Ankara merkez yol ağı Overpass ile alınabilir:

```overpass
[out:xml][timeout:180];
way["highway"](39.88,32.77,40.00,32.94);
(._;>;);
out body;
```

OSRM'nin resmî GHCR imajıyla önce `foot.lua`, sonra `car.lua` profilleri için
`osrm-extract`, `osrm-partition` ve `osrm-customize` komutları çalıştırılır.
Compose dosyasındaki OSRM imaj digest'i ön işleme ve çalışma zamanında aynı olmalıdır.

## Gerçek yaya entegrasyon testi

Ankara verisi hazırlanıp `osrm-foot` servisi çalıştırıldıktan sonra optimizasyon
klasöründe aşağıdaki ortam değişkenlerini ayarlayın:

```powershell
$env:RUN_OSRM_INTEGRATION = "1"
$env:OSRM_FOOT_URL = "http://localhost:5001"
.\.venv\Scripts\python.exe -m pytest tests\test_osrm_integration.py -q
```

Compose içinde `osrm-foot` host üzerinde `5001`, `osrm-car` ise `5002` portunda
yayımlanır. Servisler kendi aralarında yine konteyner portu `5000` üzerinden konuşur.
