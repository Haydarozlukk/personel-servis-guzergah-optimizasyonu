# Mimari Karar Kaydı

## 2026-08-01 — PoC mimarisi

- Backend `.NET 10 LTS` ve PostgreSQL/PostGIS kullanır.
- Optimizasyon servisi FastAPI ile bağımsız çalışır; Kerim bu servis ve algoritma çıktısının sahibidir.
- Backend, senaryoyu kalıcılaştırır ve VROOM çağrısının tek sahibidir.
- OSRM iki profile ayrılır: araç rotası `car`, 500 metre kontrolü `foot`.
- İlk PoC yalnızca sabah işe gidişini kapsar.
- Kamuya açık Nominatim'e gerçek personel adresi gönderilmez. Test verisi maskeli/sentetiktir.
