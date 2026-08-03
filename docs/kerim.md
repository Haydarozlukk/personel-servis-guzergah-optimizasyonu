# Kerim — Durak Optimizasyon Servisi

- FastAPI + Dockerfile ile bağımsız servis
- `foot` OSRM sonucu ile maksimum 500 m yürüme doğrulaması
- Durak adayları, kalite puanı, personel-durak ataması ve atanamayanlar
- Kapasite/rota için backend’in kullanacağı durak talep modelini üretme

VROOM HTTP çağrısı ve senaryo kalıcılığı backend’dedir; Kerim bu çağrı için gereken giriş modelinin doğruluğundan sorumludur.

## Görevler

Öncelik: **P0** yığın uçtan uca çalışmıyor, **P1** ürün hedefi eksik, **P2** kalite/süreç.

### P0-K1 — Durak adayları gerçek durak değil, personelin evi

`app/candidates.py:5` adayları personel konumlarının kendisi olarak üretiyor. Yani "durak" = birinin evinin önü; yol ağına snap yok, ızgara/kümeleme yok, duraklar arası minimum mesafe yok.

Yan etkisi kritik: her personelin kendi adayına yürüme mesafesi **0** olduğu için 500 m doğrulaması büyük ölçüde boşa çalışıyor ve `tests/test_full_stack_integration.py`'deki `unassignedPersonIds == []` / `max(distance) <= 500` iddiaları trivially geçiyor — testler algoritmayı doğrulamıyor.

- Aday üretimini gerçek yol ağına dayandır: personel konumlarını OSRM `nearest/v1/foot` ile yola snap et ve/veya ~150–200 m ızgara merkezleri üret.
- Duraklar arası minimum mesafe kısıtı ekle (aynı sokakta 3 durak çıkmasın).
- Aday sayısı personel sayısıyla birebir büyümesin; K3'teki matris maliyetini doğrudan bu belirliyor.

Kabul: 50 kişilik örnek veride durak sayısı personel sayısının belirgin altında ve her durak konumu yürünebilir bir yol üzerinde.

### P0-K2 — Durak talebi araç kapasitesiyle sınırlanmıyor

Bir durağa 30 kişi atanabiliyor; kapasitesi 16 olan araç bunu alamayınca VROOM **tüm durağı** atanamamış sayıyor (hepsi-ya-hiç). Sonuç: kapasite yeterliyken bile insanlar atanamamış görünüyor.

- `StopGenerationRequest`'e `maxStopDemand` (opsiyonel; backend en büyük araç kapasitesini geçer) alanı ekle.
- `select_stops_and_assign_persons` içinde bir durağa atanan kişi sayısını bu değerle sınırla; artan kişileri sonraki en iyi adaya taşı.
- Sözleşme değişikliği olduğu için `contracts/openapi.yaml` güncellemesini Haydar ile birlikte yap (H6 ile aynı PR'a girebilir).

Kabul: Tek 16 kapasiteli araçlı senaryoda hiçbir durağın `demand` değeri 16'yı aşmaz.

### P0-K3 — OSRM matrisi tek istekte gönderiliyor, ölçeklenmiyor (Haydar ile ortak)

`app/osrm.py` `sources + destinations` koordinatlarının tamamını tek `GET` ile gönderiyor. Adaylar personel konumları olduğu için bu **2N koordinat** demek:

- `osrm-routed` varsayılan `--max-table-size` = 100 → **51 personelde `TooBig`**. Bayrağı Haydar compose'a ekliyor (H2), ama servis tarafında da parçalama şart.
- ~500 personelde URL uzunluğu ~20 KB'a çıkıyor → HTTP 414.

Yapılacak:

- Matris isteğini kaynak/hedef bloklarına böl (örn. 100×100) ve parçaları birleştir.
- Uzun koordinat listeleri için `GET` yerine `POST` gövdesini değerlendir.
- Parçalar arası eşzamanlılığı sınırlı tut (`asyncio.Semaphore`); tek bir parçanın hatası tüm isteği `OsrmError` ile düşürsün.

Kabul: 200 personelli senaryo tek `/api/v1/stops/generate` çağrısında hatasız tamamlanır; parçalanmış matrisin tek parçalı sonuçla aynı olduğunu doğrulayan test eklenir.

### P1-K4 — `qualityScore` yanıltıcı

`app/evaluation.py` skoru atama **öncesi** kapsama oranı olarak hesaplıyor; `app/assignment.py` bunu, durağa fiilen daha az kişi atansa bile aynen `Stop`'a yazıyor. Çıktıdaki skor gerçek doluluğu yansıtmıyor.

- Seçilen durak için skoru fiilî atama üzerinden yeniden hesapla (`len(assignedPersonIds) / len(persons)`).
- Aday sıralamasında kullanılan skoru `CandidateEvaluation` içinde ayrı tut; ikisini karıştırma.
- Ortalama yürüme mesafesini de `Stop` çıktısına ekle (Efe durak kalitesini haritada gösterecek).

### P1-K5 — Yürüme süresi ve özet çıktı alanları

- OSRM `table` çağrısında `annotations=distance,duration` iste; `Stop` çıktısına kişi başı yürüme **süresi** de ekle.
- `StopGenerationResult`'a özet ekle: toplam durak sayısı, ortalama/maksimum yürüme mesafesi, atanamayan kişi sayısı. Haydar bunu `ScenarioResult`'a taşıyacak (H6).

### P1-K6 — Atanamayan personel için gerekçe

Şu an `unassignedPersonIds` sadece id listesi. 500 m içinde aday bulunamayan kişi ile OSRM'in yol bulamadığı kişi ayırt edilemiyor.

- Her atanamayan kişi için sebep kodu dön (`no_candidate_within_limit`, `no_route`, `stop_capacity_full`).

### P2-K7 — Servis yaşam döngüsü ve dayanıklılık

- `app/main.py` içindeki `get_osrm_client` her istekte yeni `OsrmFootClient` üretiyor; `AsyncClient` bağlantı havuzu kullanılmıyor. FastAPI `lifespan` ile tek paylaşılan istemci kur.
- OSRM için yeniden deneme (backoff) ve `timeout`'un ortam değişkeninden okunması yok.
- Yapılandırılmış loglama yok: istek başına personel sayısı, aday sayısı, matris parça sayısı, süre.

### P2-K8 — Paketleme ve statik analiz

- `pyproject.toml`'da `[build-system]` bloğu yok. `Dockerfile` yalnızca `pyproject.toml` mevcutken `pip install .` çalıştırıyor — setuptools otomatik keşfi bu noktada boş; kırılgan. `[build-system]` ekle veya bağımlılıkları `requirements.txt`'e ayırıp `app`'i install öncesi kopyala.
- `optimization/.dockerignore` ekle (`tests/`, `__pycache__/`, `.venv/`, `.pytest_cache/`).
- `ruff` + `mypy`'yi dev bağımlılıklarına ve CI'ya ekle (CI iskeletini Haydar kuruyor, H10).

### Mevcut durumun iyi tarafı

Python katmanı projedeki tek düzgün test edilmiş bölüm (9 dosya, ~55 test). K1 ve K2 sonrası `test_full_stack_integration.py`'deki iddiaların **anlamlı** hale geldiğini doğrula: durak sayısı, maksimum `demand` ve gerçek (sıfır olmayan) yürüme mesafeleri üzerine yeni assertion'lar ekle.
