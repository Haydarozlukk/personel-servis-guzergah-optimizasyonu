-- Bu dosya yalnızca boş bir postgres volume'unda, konteyner ilk kez ayağa
-- kalkarken çalışır. Uzantı kurulumu superuser gerektirdiği için burada yapılır.
--
-- Tablolar backend açılışında idempotent DDL ile oluşturulur
-- (backend/ServisOptimizasyon.Api/ScenarioStore.cs). Şema tek yerde tutulur ki
-- kod ile veritabanı arasında sürüklenme olmasın.
--
-- Şema değiştiğinde mevcut geliştirme volume'u için: docker compose down -v

CREATE EXTENSION IF NOT EXISTS postgis;
