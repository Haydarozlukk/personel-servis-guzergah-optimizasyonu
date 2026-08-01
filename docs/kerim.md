# Kerim — Durak Optimizasyon Servisi

- FastAPI + Dockerfile ile bağımsız servis
- `foot` OSRM sonucu ile maksimum 500 m yürüme doğrulaması
- Durak adayları, kalite puanı, personel-durak ataması ve atanamayanlar
- Kapasite/rota için backend’in kullanacağı durak talep modelini üretme

VROOM HTTP çağrısı ve senaryo kalıcılığı backend’dedir; Kerim bu çağrı için gereken giriş modelinin doğruluğundan sorumludur.
