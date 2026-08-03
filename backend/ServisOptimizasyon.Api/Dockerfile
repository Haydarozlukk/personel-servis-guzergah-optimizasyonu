FROM mcr.microsoft.com/dotnet/sdk:10.0 AS build
WORKDIR /src
# Önce yalnızca proje dosyası kopyalanır; bağımlılık katmanı önbelleğe alınır.
COPY ServisOptimizasyon.Api.csproj .
RUN dotnet restore
COPY . .
RUN dotnet publish -c Release -o /app/publish --no-restore

FROM mcr.microsoft.com/dotnet/aspnet:10.0
# Compose healthcheck'i için curl gerekir; aspnet imajında bulunmaz.
RUN apt-get update \
    && apt-get install -y --no-install-recommends curl \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ENV ASPNETCORE_URLS=http://+:8080
EXPOSE 8080
COPY --from=build /app/publish .
ENTRYPOINT ["dotnet", "ServisOptimizasyon.Api.dll"]
