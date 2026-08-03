# Haydar — Backend ve Entegrasyon

- `.NET 10` API, PostgreSQL/PostGIS şeması ve Excel aktarımı
- Senaryo kalıcılığı ile VROOM çağrısının tek sahipliği
- Docker Compose, `develop` dalı ve PR düzeni
- Efe'nin onaylanmış API ihtiyacına göre manuel düzenleme uçları

Kerim'in durak üretim algoritmasının iç mantığına müdahale edilmez; yalnızca OpenAPI sözleşmesine uyum doğrulanır.

## Görevler

Durum: ✅ tamamlandı, ⛔ başkasına bağlı, ⬜ açık.

### ✅ H1 — VROOM zaman penceresi

`VroomVehicle.TimeWindow` camelCase serialize edildiği için VROOM kısıtı sessizce yok sayıyordu ve
`arrivalDeadline` hiç uygulanmıyordu.

- `Models.cs`: `[property: JsonPropertyName("time_window")]` eklendi.
- `contracts/openapi.yaml`: `VroomVehicle.time_window` olarak düzeltildi, nedeni not olarak yazıldı.
- Regresyon testi: `ScenarioOrchestratorTests.VroomRequestUsesSnakeCaseTimeWindow` gönderilen ham gövdede
  `"time_window":[0,30600]` arar ve `timeWindow` bulunmadığını doğrular.

### ✅ H2 — OSRM tablo limiti

`compose.yaml`: her iki `osrm-routed` komutuna `--max-table-size 10000` eklendi. Varsayılan 100 olduğu için
51 personelde `TooBig` alınıyordu. Servis tarafındaki parçalama Kerim'de (K3).

### ✅ H3 — Arka plan işi ve gerçek `202` semantiği

- `ScenarioProcessing.cs`: `ScenarioQueue` (bounded `Channel`) + `ScenarioWorker : BackgroundService`.
- POST artık senaryoyu kalıcılaştırıp kuyruğa atar ve hemen `202` + `Location` döner.
- İş, istek `CancellationToken`'ı ile değil uygulama yaşam döngüsü token'ı ile çalışır; istemci bağlantıyı
  koparsa iş tamamlanmaya devam eder.
- `status` alanı `queued` → `running` → `completed`/`failed` olarak ilerler; enum sözleşmeye eklendi.

### ✅ H4 — PostgreSQL kalıcılığı

- `Npgsql` referansı eklendi; `ConnectionStrings:Postgres` artık gerçekten kullanılıyor.
- `ScenarioStore.cs`: `scenarios`, `scenario_persons`, `scenario_vehicles`, `scenario_stops`,
  `stop_person_assignments`, `scenario_routes`, `scenario_route_steps`, `scenario_unassigned_persons`.
  Koordinatlar `geography(Point,4326)`; `ST_MakePoint` / `ST_X` / `ST_Y` ile yazılıp okunuyor, bu yüzden
  NetTopologySuite bağımlılığı yok.
- Şema backend açılışında idempotent DDL ile kurulur (10 denemeli geri çekilme). `init.sql` yalnızca
  `CREATE EXTENSION postgis` yapar; şema tek yerde durduğu için kod/veritabanı sürüklenmesi olmaz.
- Bağlantı dizesi tanımsızsa `InMemoryScenarioStore` devreye girer ve açılışta uyarı loglanır
  (Postgres'siz `dotnet run` için).

**Dikkat:** eski `scenario_stops` tablosu farklı şemadaydı. Mevcut geliştirme volume'unda
`docker compose down -v` çalıştırılmalıdır.

### ✅ H5 — Frontend build değişkeni

`compose.yaml` `environment` yerine `build.args` kullanıyor. Karşı taraf (E1) tek satırlık olduğu için
`frontend/servis-optimizasyon-ui/Dockerfile`'a `ARG/ENV VITE_API_BASE_URL` da eklendi — Efe'nin dosyası,
PR'da kendisine haber verilmeli.

### ✅ H6 — `ScenarioResult` harita için yeterli veriyi taşıyor

Eklenen alanlar: `name`, `deadlineSeconds`, `stops[]` (konum, atanan personel, yürüme mesafeleri, demand,
qualityScore), `routes[].steps[]` (`stopId`, `arrivalSeconds`, `load`), `routes[].arrivalSeconds`,
`routes[].deadlineMet`, `deadlineMet`, `warnings[]`, `createdAt`, `updatedAt`. Sözleşme önce güncellendi.

### ✅ H7 — Biniş süresi ve varış fizibilitesi

- `VroomJob.service` = `StopBaseServiceSeconds` + `BoardingSecondsPerPerson` × demand
  (varsayılan 30 + 10×kişi, `appsettings.json` → `Optimization` bölümünden ayarlanır).
- Rota bazında ve senaryo bazında `deadlineMet`; aşım varsa `warnings` içine mesaj düşer.

### ✅ H9 — Doğrulama ve null güvenliği

- `ScenarioValidator`: aynı alan için birden fazla hata artık birikiyor (önce ikinci mesaj birincisini
  eziyordu), `ErrorBag` ile toplanıyor.
- `ScenarioInput` alanları `required`; eksik alan 500 yerine 400 döner. Açıkça `null` gönderilen listeler
  de ele alınıyor. `IsCoordinate` artık `NaN`/`Infinity` değerlerini de reddediyor.
- Toplam araç kapasitesi personel sayısından azsa senaryo reddedilmez ama `warnings` alanına uyarı yazılır.

### ✅ H10 — Test projesi, çözüm dosyası ve CI

- `backend/ServisOptimizasyon.sln` + `backend/ServisOptimizasyon.Api.Tests` (xunit).
- 30 test: `ScenarioValidatorTests`, `ScenarioOrchestratorTests` (sahte `HttpMessageHandler` ile VROOM ve
  optimizasyon servisi), `ScenarioExcelImportTests`, `InMemoryScenarioStoreTests`. Testler ağ/DB gerektirmez.
- `.github/workflows/ci.yml`: `dotnet test`, `npm ci && lint && build`, `pytest`, OpenAPI YAML doğrulaması.

### ✅ H11 — Compose ve güvenlik temizliği

- `optimization` → `osrm-foot` profiller arası `depends_on` bağımlılığı kaldırıldı; profilsiz `up` artık
  tutarlı. `backend` artık `optimization`'ın sağlıklı olmasını bekliyor.
- `backend`, `optimization`, `frontend` için healthcheck + `restart: unless-stopped`.
- `backend/ServisOptimizasyon.Api/.dockerignore` eklendi; Dockerfile katmanlı restore yapıyor.
- CORS artık `ALLOWED_ORIGINS` ortam değişkeninden okunuyor; boşsa açılışta uyarı loglanıyor.
- HTTP istemcilerine zaman aşımı, hata gövdesini mesaja taşıma ve senaryo başına yapılandırılmış log eklendi.

### ✅ H8 (kısmi) — Excel içe aktarma

- `POST /api/v1/scenarios/import` (multipart): `personel` sayfası zorunlu (`id`, `boylam`, `enlem`),
  `araclar` sayfası opsiyonel (`id`, `kapasite`, `boylam`, `enlem`). Araç sayfası yoksa `vehicleCount` ve
  `vehicleCapacity` form alanlarından araç üretilir ve işyerinden başlatılır.
- Türkçe Excel çıktısındaki virgüllü ondalık ayırıcı destekleniyor.
- `GET /api/v1/scenarios/import/template` boş şablon üretir.
- Yüklenen dosya diske yazılmaz ve içeriği loglanmaz (`docs/kararlar.md`). Sınır: 5 MB.
- `POST /api/v1/scenarios/{id}/reoptimize`: kayıtlı duraklarla yalnızca rotalamayı yeniden çalıştırır,
  gövdede araç listesi verilirse araçları değiştirir.

### ⛔ H8 (kalan) — Manuel düzenleme uçları

Yapılmadı; kapsamı bilinçli olarak açık bırakıldı. İki bağımlılık var:

1. **Efe'nin yazılı API ihtiyacı yok.** `docs/haydar.md` ve `docs/efe.md` bu uçların kapsamını Efe'nin
   talebine bağlıyor (E5). Tahmine dayalı bir uç açmak, sonra Efe'nin ona uymak zorunda kalması demek.
2. **Kerim'de yeni bir uç gerekiyor.** Bir personeli elle başka bir durağa taşımak, o taşımanın 500 m
   yürüme kuralını bozup bozmadığını doğrulamayı gerektirir. Backend'de foot-OSRM erişimi yok; bunun için
   optimizasyon servisinde tekil mesafe sorgusu açılmalı, örneğin:

   `POST /api/v1/walking-distance` → `{ "from": [lon,lat], "to": [lon,lat] }` → `{ "meters": 412.0 }`

   Bu uç olmadan manuel atama, projenin tek sert kuralını sessizce ihlal edebilir.

**Sonraki adım:** Efe'den uç listesi gelsin, Kerim'den yürüme mesafesi ucu açılsın, ardından
`PATCH /api/v1/scenarios/{id}/assignments` ve durak taşıma uçları eklenir.

### ✅ Kerim'in PR #3 çalışmasıyla birleştirme

Bu dal `main`'e rebase edilirken Kerim'in durak üretim sözleşmesi genişlemişti. Backend buna uyarlandı:

- `GeneratedStop` → `walkingDurationsSeconds`, `averageWalkingDistanceMeters`
- `StopGenerationResult` → `unassignedPersons` (gerekçeli), `summary`
- `StopResult` yürüme sürelerini ve ortalama mesafeyi taşıyor; ikisi de kalıcılaştırılıyor
  (`stop_person_assignments.walking_duration_seconds`, `scenario_stops.average_walking_distance_meters`).
- `scenario_unassigned_persons.reason` eklendi. Backend kendi gerekçesi olarak `not_routed` üretir
  (VROOM durağı hiçbir araca atayamadıysa); optimizasyon servisinden gelen gerekçe önceliklidir.
- Durak üretim özeti `scenarios` tablosunda `summary_*` kolonlarında tutulur ve `ScenarioResult` içinde
  `stopGenerationSummary` olarak döner. Yeniden rotalamada durak üretimi çalışmadığı için özet null
  geçilir ve kayıtlı değer korunur.
- `ruff` ve `mypy` adımları CI'daki optimizasyon işine eklendi (ikisi de yerelde temiz).

### ⬜ Doğrulanmamış: derleme ve entegrasyon

Bu makinede .NET SDK ve Docker kurulu olmadığı için kod **derlenmedi ve testler çalıştırılmadı**.
PR öncesi şunlar çalıştırılmalı:

```bash
dotnet test backend/ServisOptimizasyon.sln
```

Aşağıdakiler .NET 10.0.302 ile yerelde doğrulandı:

- `dotnet build --configuration Release` → 0 uyarı, 0 hata
- `dotnet test` → 39/39 geçti
- `pytest` → 41 geçti, 4 atlandı (gerçek OSRM/VROOM gerektirenler)
- `ruff check .` ve `mypy app` → temiz
- `openapi.yaml`, `compose.yaml`, `ci.yml` → geçerli YAML, tüm `$ref`'ler çözülüyor

**Hâlâ doğrulanmadı:**

1. **Postgres şeması.** `ScenarioStore.cs` içindeki DDL ve Npgsql sorguları gerçek veritabanına karşı
   çalıştırılmadı (Docker Desktop açılmadı). Kontrol için:

   ```
   docker compose up -d postgres backend
   curl http://localhost:8080/health/ready
   ```

   Backend açılışta şemayı kurar; `200` dönerse DDL geçmiş demektir.

2. **Arayüz derlemesi.** Node kurulu olmadığı için `npm ci && npm run lint && npm run build`
   çalıştırılamadı. Frontend kaynağında değişiklik yok; yalnızca Dockerfile'a `ARG` eklendi.
