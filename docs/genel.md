# Personel Servis Güzergâh Optimizasyonu

## Durum

- **Backend (Haydar):** senaryo kalıcılığı PostgreSQL/PostGIS üzerinde, optimizasyon arka planda kuyrukla
  çalışıyor, VROOM zaman penceresi kısıtı uygulanıyor, Excel içe aktarma ve yeniden hesaplama uçları hazır,
  birim testleri ve CI kurulu. Kalan iş: manuel düzenleme uçları (Efe'nin API talebine ve Kerim'in yürüme
  mesafesi ucuna bağlı). Ayrıntı: [`haydar.md`](haydar.md).
- **Optimizasyon (Kerim):** durak adayları ızgara tabanlı üretiliyor, OSRM matrisi parçalanıyor, durak
  kapasite sınırı, yürüme süreleri, atanamama gerekçeleri ve üretim özeti dönüyor; ruff/mypy temiz.
  Ayrıntı: [`kerim.md`](kerim.md).
- **Arayüz (Efe):** hâlâ Faz 0 mock haritası; senaryo sonucu okunmuyor. Ayrıntı: [`efe.md`](efe.md).

## Sınırlar

- Personel adresleri kişisel veridir; depoya veya dış geocoding servisine gerçek değer yazılmaz.
- İlk senaryo yalnızca sabah işe gidişidir; personel sayısı, araç sayısı ve araç kapasitesi kullanıcı girdisidir.
- 500 metre kabulü düz çizgiye göre değil, `foot` yönlendirme mesafesine göre verilir.

## Servis sözleşmesi

Ortak HTTP şeması: [`../contracts/openapi.yaml`](../contracts/openapi.yaml)

1. Backend senaryoyu alır ve kalıcılaştırır.
2. Kerim'in optimizasyon servisi durak adayları ile personel atamalarını üretir.
3. Backend VROOM isteğini oluşturur ve sonucu kaydeder.
4. Efe'nin arayüzü senaryo sonucunu haritada gösterir.

## Çalışma akışı

Her değişiklik kişi dalında yapılır ve `develop` dalına PR olarak gelir. Faz sonlarında üç kişi aynı örnek veriyle kısa entegrasyon demosu yapar.
