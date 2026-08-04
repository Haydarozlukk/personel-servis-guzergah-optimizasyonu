# Efe — Harita ve Kullanıcı Deneyimi

- React/TypeScript/Leaflet arayüzü
- Ortak OpenAPI’ye uygun mock veri ile paralel geliştirme
- Personel, durak, 500 m alan, rota, süre/mesafe/doluluk gösterimi
- Manuel düzenleme ve senaryo karşılaştırma için API gereksinimlerini yazılı iletme

Mock haritadaki 500 m çemberi görseldir; gerçek uygunluk backend/optimizasyon sonucu ile gösterilecektir.

## Görevler

Öncelik: **P0** yığın uçtan uca çalışmıyor, **P1** ürün hedefi eksik, **P2** kalite/süreç.

### P0-E1 — API adresi build'e hiç girmiyor (Haydar ile ortak)

`compose.yaml:47` `VITE_API_BASE_URL`'i nginx konteynerine **runtime** environment olarak veriyor; Vite bu değişkeni **build** anında bundle'a gömüyor. `frontend/servis-optimizasyon-ui/Dockerfile` ise `ARG` tanımlamıyor. Sonuç: üretilen bundle'da `import.meta.env.VITE_API_BASE_URL === undefined` ve `App.tsx` isteği `"undefined/api/v1/scenarios"` adresine gidiyor — Docker ile kaldırıldığında UI backend'e **hiç** bağlanamıyor.

- Dockerfile'a `ARG VITE_API_BASE_URL` + `ENV VITE_API_BASE_URL=$VITE_API_BASE_URL` ekle (build aşamasında, `npm run build`'den önce).
- Haydar compose'da `environment` yerine `build.args` kullanacak (H5).
- Değişken tanımsızsa build'i patlat ya da `http://localhost:8080`'e düş; sessizce `undefined` kalmasın.

Kabul: `docker compose --profile routing up --build` sonrası tarayıcı ağ sekmesinde istek `http://localhost:8080/api/v1/scenarios` olarak görünür.

### P0-E2 — Sonuç hiç okunmuyor, arayüz Faz 0'da donmuş

`src/App.tsx` yalnızca sentetik spiral mock çiziyor. `GET /api/v1/scenarios/{id}` **hiç çağrılmıyor**; POST'un döndürdüğü `id` kullanılmadan atılıyor ve ekranda sadece "kuyruğa alınacak" yazıyor.

- POST cevabındaki `id` ile `GET /api/v1/scenarios/{id}` polling'i kur (Haydar H3'te `status` alanına `queued`/`running`/`completed`/`failed` ekliyor; buna göre dur).
- `completed` olunca sonucu haritaya bas, `failed` olunca `error` alanını göster.

### P0-E3 — Hata yönetimi yok

`createScenario` try/catch içermiyor ve `void createScenario()` ile çağrılıyor; ağ hatasında unhandled promise rejection oluşuyor, kullanıcı hiçbir şey görmüyor.

- `try/catch/finally`, buton disabled durumu, yükleniyor göstergesi ve okunabilir hata mesajı ekle.
- 400 doğrulama cevabındaki `ValidationProblem` alanlarını forma bağla.
- Sayı girdilerinde `Number(event.target.value)` boş girişte `NaN`/`0` üretiyor; alt sınır uygula.

### P1-E4 — Harita gerçek sonucu göstermeli

Bugün 500 m çemberi duraklara değil **işyerine** çiziliyor — kavramsal olarak yanlış. Haydar `ScenarioResult`'a `stops[]` ekliyor (H6); o iniş yaptığında:

- Durak işaretçileri + her durak için 500 m çemberi (işyeri için değil).
- Rota çizgileri: `routes[].geometry` encoded polyline'ını çöz (`@mapbox/polyline`) ve araç başına ayrı renkle çiz.
- Personel → atandığı durak bağlantı çizgisi; popup'ta yürüme mesafesi.
- Atanamayan personeli ayrı renkte göster ve gerekçesini yaz (Kerim K6'da sebep kodu dönecek).
- Yan panelde araç başına mesafe/süre/doluluk (`distanceMeters`, `durationSeconds`, `load` / kapasite) özeti.
- react-leaflet + Vite'ta varsayılan `Marker` ikonlarının 404 vermesi klasik bir sorundur; ikon yolunu açıkça ayarla.

### P1-E5 — Gerçek veri girişi ve manuel düzenleme

~~`src/mock/scenario.ts` spiral üretici dışında veri girişi yolu yok.~~ **2026-08-04 güncelleme:**
mock/"Hızlı senaryo" ekranı ve spiral üretici tamamen kaldırıldı; Excel içe aktarma artık tek giriş
yolu. `İşyeri boylam/enlem` sayısal alanları da tek bir `İşyeri adresi` metin alanına dönüştürüldü —
bkz. aşağıdaki "Adres tabanlı girdi" talebi, bu alan şu an backend'de karşılığı olmayan
`workplaceAddress` gönderiyor.

Ayrıca haritadan tıklayarak (ad/soyad sorarak) sonradan personel ekleme akışı arayüzde hazır
(`AddPersonPanel`), ama `POST /api/v1/scenarios/{scenarioId}/persons` ucu olmadığı için şu an
çalışmıyor — aşağıdaki "Sonradan personel ekleme" talebine bakın.

- Personel/araç listesini elle girme veya Excel yükleme akışı (Haydar H8'de `POST /api/v1/scenarios/import` açıyor). ✅ Excel yükleme tarafı bağlandı.
- Manuel düzenleme (personelin durağını değiştirme, durak taşıma) için ihtiyaç duyduğun uçları **yazılı** olarak Haydar'a ilet — `docs/efe.md` sorumluluğun bu; uçların kapsamını senin talebin belirliyor.
- Senaryo karşılaştırma ekranı (iki senaryonun mesafe/süre/doluluk farkı) için gerekli API'yi de aynı belgede iste.

Not: `docs/kararlar.md` gereği gerçek personel adresi ne depoya ne de public Nominatim'e gider; geocoding UI'da yapılmayacak — backend'de (private geocoder ile) yapılacak, bkz. aşağıdaki talep.

## API talepleri (Haydar'a)

P1-E5 kapsamında istenen manuel düzenleme ve senaryo karşılaştırma için arayüzde
gösterecek veri yok — aşağıdaki uçlar olmadan bu iki özellik inşa edilemiyor.
`POST /api/v1/scenarios/{id}/reoptimize` zaten var ve kalıcılaştırılmış
duraklarla rotayı yeniden hesaplıyor; aşağıdaki uçlar yalnızca *duraklar/atamalar*
üzerinde manuel değişiklik yapmayı sağlıyor, rota hesaplamasını değil — değişiklik
sonrası frontend zaten var olan `/reoptimize`'ı çağırır.

### Manuel düzenleme

**`PATCH /api/v1/scenarios/{scenarioId}/stops/{stopId}`** — durağı taşı
- Gövde: `{ "location": [boylam, enlem] }`
- Backend, durağa atanmış her personelin `walkingDistancesMeters`/
  `walkingDurationsSeconds` değerini foot-OSRM ile yeniden hesaplar (tek durak,
  küçük matris).
- Cevap: güncellenmiş `Stop` nesnesi + `personsOverLimit: string[]` (500 m'yi
  aşan ama yine de atanmış kalan personel kimlikleri — frontend bunları
  kullanıcıya "yeniden ata" uyarısıyla gösterir).
- Senaryonun kayıtlı durağı yoksa `409` (reoptimize ile aynı kısıt).

**`POST /api/v1/scenarios/{scenarioId}/persons/{personId}/reassign`** — personeli başka bir durağa taşı
- Gövde: `{ "stopId": "stop-003" }` (yalnızca senaryodaki mevcut bir durağa taşıma;
  yeni durak oluşturma kapsam dışı — onu `PATCH .../stops/{stopId}` ile zaten
  var olan bir durağı taşıyarak yapıyoruz)
- Backend personeli eski durağın `assignedPersonIds` listesinden çıkarır, yeni
  durağa ekler; yeni durağa gerçek yürüme mesafesini/süresini foot-OSRM ile
  hesaplar.
- Cevap: `{ distanceMeters, durationSeconds, overLimit: boolean }`.
- Bilinçli tasarım kararı: 500 m sınırını aşan manuel taşımayı **reddetme,
  `overLimit` ile işaretleyip kabul et** — bu zaten kullanıcının bilinçli
  override'ı, otomatik atamadan farklı olarak.
- Durak veya personel senaryoda bulunamazsa `404`.

### Adres tabanlı girdi (personel + işyeri) — yeni, 2026-08-04

Mock ekranı kaldırıldıktan sonra Excel içe aktarma tek giriş yolu; kullanıcı artık boylam/enlem
değil **adres** giriyor (hem personel sayfasında hem işyeri alanında). Bugünkü sözleşme ikisini de
sayı olarak istiyor — bu talep onu adrese çeviriyor.

**`POST /api/v1/scenarios/import`** — `workplaceLongitude`/`workplaceLatitude` form alanları yerine
tek bir `workplaceAddress: string` alanı. Frontend (`ExcelImportForm`) bu alanı zaten gönderiyor;
backend adresi private geocoder ile enlem/boylama çevirsin (Nominatim'e gerçek adres gitmiyor,
`docs/kararlar.md`).

**Excel şablonu** — `personel` sayfasındaki `boylam`/`enlem` sütunları yerine tek bir `adres` sütunu.
`GET /api/v1/scenarios/import/template` bunu üretmeli; içe aktarma da satır başına adresi geocode
edip Postgres'e enlem/boylam olarak yazmalı.

**`ScenarioResult`** — işyerinin geocode edilmiş konumunu da cevaba ekle (örn. `workplace: Coordinate`).
Frontend haritada işyeri iğnesini bugün göstermiyor çünkü elinde hiç koordinat yok; bu alan gelince
`ScenarioMap`'e geri eklenecek.

### Sonradan personel ekleme + yeniden optimize — yeni, 2026-08-04

Kullanıcı, tamamlanmış bir senaryoya haritadan tıklayarak (ad/soyad girerek) yeni personel
ekleyebilmeli; "Rotayı yeniden optimize et" dediğinde o kişi Postgres'e yazılmalı ve senaryo
yeniden optimize edilmeli. Bu, var olan `/reoptimize`'tan farklı — yeni kişi henüz hiçbir durağa
atanmamış, dolayısıyla yalnızca rotalama değil **durak üretimi de** yeniden çalışmalı.

**`POST /api/v1/scenarios/{scenarioId}/persons`**
- Gövde: `{ "persons": [{ "firstName": string, "lastName": string, "location": [boylam, enlem] }] }`
  (konum haritadan tıklanan nokta; adres/geocoding gerekmiyor, bu akış zaten tam koordinat veriyor).
- Backend: kişileri `scenario_persons`'a ekler, durak üretimini (Kerim'in `/stops/generate`'i) ve
  VROOM'u tam senaryo için yeniden çalıştırır — mevcut `/reoptimize` gibi kalıcılaştırılmış duraklarla
  sınırlı kalamaz, çünkü yeni kişi hiçbir durağa ait değil.
- Cevap: `POST /api/v1/scenarios` ile aynı şekilde `202` + `ScenarioAccepted`; frontend zaten var olan
  polling (`GET /api/v1/scenarios/{id}`) ile sonucu bekliyor.
- Senaryo bulunamazsa `404`.

Frontend tarafı (`lib/api.ts` → `addPersonsAndReoptimize`, `useScenarioSubmission.submitNewPersons`,
`components/AddPersonPanel.tsx`) bu sözleşmeyi varsayarak hazır; uç açılınca ekstra frontend
değişikliği gerekmemeli.

### Excel yükleme boyut sınırı — yeni, 2026-08-04

`docs/haydar.md` H8: Kestrel `MaxRequestBodySize` 8 MB, dosya sınırı 5 MB. Excel dosyaları
(özellikle çok satırlı personel listeleri) bu sınırı zorlayabiliyor — sınırı kaldır veya en azından
büyüt (örn. 25 MB dosya / 30 MB istek). Frontend'deki sabit "en fazla 5 MB" ibaresini kaldırdım;
413 hata mesajı artık belirli bir sayı iddia etmiyor.

### Senaryo karşılaştırma

Karşılaştırma ekranının hangi iki senaryoyu karşılaştıracağını seçebilmesi için
bir liste ucu gerekiyor — şu an yalnızca tekil `GET /api/v1/scenarios/{id}` var.

**`GET /api/v1/scenarios?limit=20&offset=0`** — senaryo listesi
- Cevap: `{ items: [{ id, name, status, createdAt, routeCount, unassignedPersonCount }], total }`,
  varsayılan sıralama `createdAt` azalan.
- Karşılaştırmanın kendisi için yeni bir uca gerek yok: frontend seçilen iki id
  için mevcut `GET /api/v1/scenarios/{id}`'yi iki kez çağırıp
  `distanceMeters`/`durationSeconds`/`load` farkını istemci tarafında hesaplar.

### P2-E6 — Build ve test hijyeni

- `Dockerfile:3-4` yalnızca `package.json` kopyalayıp `npm install` çalıştırıyor; mevcut `package-lock.json` kullanılmıyor → build'ler tekrarlanabilir değil. `COPY package*.json ./` + `npm ci` yap.
- `frontend/servis-optimizasyon-ui/.dockerignore` ekle (`node_modules/`, `dist/`).
- Frontend'de **tek bir test yok**. Vitest + Testing Library kur; en azından senaryo gönderme ve polling akışını `fetch` mock'uyla test et.
- `npm run lint` ve `npm run build` CI'da koşacak (iskeleti Haydar kuruyor, H10) — lint hatalarını temizle.
- `App.tsx` tek dosyada büyüyor; harita, kontrol paneli ve API istemcisini ayrı modüllere böl. `contracts/openapi.yaml`'dan TypeScript tipi üret (`openapi-typescript`) ki sözleşme kayması derleme zamanında yakalansın.
