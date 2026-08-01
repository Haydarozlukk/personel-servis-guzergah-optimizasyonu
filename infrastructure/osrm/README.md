# OSRM verisi

OSRM'nin `car` ve `foot` profilleri ön işleme anında oluşur. Ankara OSM PBF girdisinden iki ayrı çıktı üretin ve sonuçları `data/car.osrm*` ile `data/foot.osrm*` olarak yerleştirin.

Bu büyük veri dosyaları Git'e alınmaz. Compose içinde routing profili açıldığında `osrm-car` ve `osrm-foot` servisleri çalışır.
