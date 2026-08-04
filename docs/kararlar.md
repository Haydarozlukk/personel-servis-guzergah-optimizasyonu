# Mimari Karar Kaydı

## 2026-08-01 — PoC mimarisi

- Backend `.NET 10 LTS` ve PostgreSQL/PostGIS kullanır.
- Optimizasyon servisi FastAPI ile bağımsız çalışır; Kerim bu servis ve algoritma çıktısının sahibidir.
- Backend, senaryoyu kalıcılaştırır ve VROOM çağrısının tek sahibidir.
- OSRM iki profile ayrılır: araç rotası `car`, 500 metre kontrolü `foot`.
- İlk PoC yalnızca sabah işe gidişini kapsar.
- Kamuya açık Nominatim'e gerçek personel adresi gönderilmez. Test verisi maskeli/sentetiktir.

## 2026-08-04 — Excel adreslerinin koordinata dönüştürülmesi

- Personel Excel sayfası `id` ve `adres` sütunlarını kabul eder; koordinat dönüşümü
  tarayıcıda değil backend'de yapılır.
- Geocoding için herkese açık varsayılan servis tanımlanmaz. `Geocoding:BaseUrl`
  yalnızca kurumun onayladığı/self-hosted Nominatim uyumlu uç noktayı göstermelidir.
- Ham Excel diske yazılmaz, adresler loglanmaz ve aynı süreçte yinelenen sorgular
  bellek içi önbellekten karşılanır.
- Bulunamayan adresler optimizasyona aktarılmaz; kullanıcıya Excel satır numarası ve
  personel kimliğiyle doğrulama hatası döner.

## 2026-08-03 — Backend kalıcılık ve iş kuyruğu

- Senaryo şeması **backend açılışında idempotent DDL ile** kurulur; `init.sql` yalnızca PostGIS uzantısını
  kurar. Gerekçe: şemanın iki yerde tutulması kod ile veritabanı arasında sürüklenme üretiyordu ve şema
  değişikliği her seferinde volume silmeyi gerektiriyordu.
- Koordinatlar `geography(Point,4326)` olarak saklanır ancak `ST_MakePoint`/`ST_X`/`ST_Y` ile ham SQL
  üzerinden yazılır. Gerekçe: NetTopologySuite bağımlılığı PoC için gereksiz ağırlık.
- Optimizasyon isteği **arka plan kuyruğunda** çalışır; HTTP isteği yalnızca kaydı oluşturup `202` döner.
  Gerekçe: senkron çalıştırmada istemci zaman aşımı sonucu tamamen kaybettiriyordu.
- Bağlantı dizesi tanımsızsa bellek içi depo kullanılır ve açılışta uyarı loglanır. Yalnızca Postgres'siz
  yerel geliştirme içindir.
- VROOM alan adları snake_case doğrulanmadan gönderilmez. `time_window` camelCase gittiği sürece varış
  saati kısıtı sessizce yok sayılıyordu; bu davranış artık bir birim testiyle korunuyor.
