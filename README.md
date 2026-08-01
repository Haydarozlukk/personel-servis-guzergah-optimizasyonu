# Personel Servis Güzergâh Optimizasyonu

Kurum personelinin en fazla 500 metre **gerçek yürüme mesafesi** ile ulaşabildiği durakları üretir; araç kapasitesi ve zaman kısıtlarıyla VROOM üzerinde rota önerir.

## PoC sınırı

- 50 maskelenmiş personel, 5 araç
- Yalnızca sabah işe gidiş senaryosu
- Yürüme doğrulaması: OSRM `foot` profili ile `<= 500 m`
- Araç rotası: OSRM `car` + VROOM
- Adres/geocoding için gerçek personel verisi veya public Nominatim kullanılmaz

## Bileşenler

- `backend/`: .NET 10 Web API; senaryo ve entegrasyon orkestrasyonu
- `frontend/`: React + TypeScript + Leaflet haritası
- `optimization/`: Kerim'in sahip olduğu FastAPI servisi; durak üretimi ve atama
- `infrastructure/`: PostgreSQL/PostGIS, OSRM, VROOM ve Compose altyapısı
- `contracts/openapi.yaml`: katmanlar arası ortak HTTP sözleşmesi

## Başlatma

1. `.env.example` dosyasını `.env` olarak kopyalayıp parolayı değiştirin.
2. Ankara OSM verisinden `car` ve `foot` için OSRM ön işleme çıktısı üretin; ayrıntı için `infrastructure/osrm/README.md`.
3. `docker compose --profile routing up --build` çalıştırın.

Yerel geliştirme araçları hazır olduğunda sırasıyla `dotnet test`, `npm.cmd ci && npm.cmd run build` ve `python -m pytest` çalıştırılır.

## Git akışı

`main` korumalı sürüm dalıdır. Günlük entegrasyon `develop` üzerinde yapılır. Her iş `feature/haydar/*`, `feature/efe/*` veya `feature/kerim/*` dalından PR ile `develop`a alınır.
