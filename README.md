# Personel Servis Güzergâh Optimizasyonu

Kurum personelinin en fazla 500 metre **gerçek yürüme mesafesi** ile ulaşabildiği durakları üretir; araç kapasitesi ve zaman kısıtlarıyla VROOM üzerinde rota önerir.

## PoC sınırı

- Personel sayısı, araç sayısı ve araç kapasitesi kullanıcı tarafından belirlenir; 50 personel/5 araç yalnızca örnek veri ölçeğidir
- Yalnızca sabah işe gidiş senaryosu
- Yürüme doğrulaması: OSRM `foot` profili ile `<= 500 m`
- Araç rotası: OSRM `car` + VROOM
- Adres/geocoding için gerçek personel verisi veya public Nominatim kullanılmaz

## Bileşenler

- `backend/`: .NET 10 Web API; senaryo kalıcılığı ve entegrasyon orkestrasyonu
- `frontend/`: React + TypeScript + Leaflet haritası
- `optimization/`: Kerim'in sahip olduğu FastAPI servisi; durak üretimi ve atama
- `infrastructure/`: PostgreSQL/PostGIS, OSRM, VROOM ve Compose altyapısı
- `contracts/openapi.yaml`: katmanlar arası ortak HTTP sözleşmesi

## Başlatma

1. `.env.example` dosyasını `.env` olarak kopyalayıp parolayı değiştirin.
2. Ankara OSM verisinden `car` ve `foot` için OSRM ön işleme çıktısı üretin; ayrıntı için `infrastructure/osrm/README.md`.
3. `docker compose --profile routing up --build` çalıştırın.

`--profile routing` verilmezse yalnızca `postgres`, `backend`, `optimization` ve `frontend` ayağa kalkar;
OSRM ve VROOM olmadığı için durak üretimi `503` döner. Uygulama servisleri yine de sağlıklı çalışır.

Docker Desktop kullanıcı kurulumunda CLI PATH içinde değilse Windows'ta şu tam yol kullanılabilir:

```powershell
& "$env:LOCALAPPDATA\Programs\DockerDesktop\resources\bin\docker.exe" compose --profile routing up -d --build
```

**Veritabanı şeması:** tablolar backend açılışında idempotent DDL ile oluşturulur; `init.sql` yalnızca
PostGIS uzantısını kurar. Şema değiştiğinde mevcut geliştirme volume'u için `docker compose down -v` gerekir.

## API akışı

1. `POST /api/v1/scenarios` — senaryo kalıcılaştırılır, kuyruğa alınır, `202` + `Location` döner.
2. `GET /api/v1/scenarios/{id}` — `status` alanı `queued` → `running` → `completed`/`failed` ilerler.
   `completed` olduğunda `stops[]`, `routes[]` (geometri, adım bazlı varış saatleri, doluluk),
   `unassignedPersonIds[]`, `deadlineMet` ve `warnings[]` döner.
3. `POST /api/v1/scenarios/import` — Excel'den senaryo oluşturur (`personel` sayfası zorunlu,
   `araclar` sayfası opsiyonel). `GET /api/v1/scenarios/import/template` boş şablon indirir.
4. `POST /api/v1/scenarios/{id}/reoptimize` — kayıtlı duraklarla rotayı yeniden hesaplar; gövdede araç
   listesi verilirse araçları değiştirir.
5. `GET /health` canlılık, `GET /health/ready` veritabanı erişilebilirliği.

Tam sözleşme: [`contracts/openapi.yaml`](contracts/openapi.yaml). Koordinatlar `[boylam, enlem]`,
zaman alanları gün başlangıcından itibaren saniye (08:30:00 = 30600).

## Test

Backend birim testleri (ağ ve veritabanı gerektirmez):

```bash
dotnet test backend/ServisOptimizasyon.sln
```

Optimizasyon birim ve API testleri:

```powershell
cd optimization
.\.venv\Scripts\python.exe -m pytest -q
```

Tüm Docker servisleri çalışırken gerçek OSRM ve VROOM entegrasyon testleri:

```powershell
$env:RUN_FULL_STACK_INTEGRATION = "1"
.\.venv\Scripts\python.exe -m pytest -q
```

Arayüz:

```bash
npm ci && npm run lint && npm run build
```

50 personel ve 5 araçlık sentetik test verisi `samples/poc-scenario-50.json` içindedir.

Bu dört komut `.github/workflows/ci.yml` içinde `main` ve `develop` dallarına gelen her PR'da çalışır.

## Git akışı

`main` korumalı sürüm dalıdır. Günlük entegrasyon `develop` üzerinde yapılır. Her iş `feature/haydar/*`, `feature/efe/*` veya `feature/kerim/*` dalından PR ile `develop`a alınır.
