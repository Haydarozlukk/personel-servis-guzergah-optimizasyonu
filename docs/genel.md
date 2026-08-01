# Personel Servis Güzergâh Optimizasyonu

## Durum

Faz 0 başlangıç iskeleti oluşturuldu. Uygulama kodu henüz PoC düzeyinde sağlık uçları ve mock haritadır.

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
