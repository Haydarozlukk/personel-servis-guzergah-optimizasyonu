$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Net.Http

$baseUrl = "http://localhost:8080"
$filePath = Join-Path $env:USERPROFILE "Downloads\Servis_Adres_Formlari_ImportReady.xlsx"

$handler = New-Object System.Net.Http.HttpClientHandler
$handler.CookieContainer = New-Object System.Net.CookieContainer
$client = New-Object System.Net.Http.HttpClient($handler)

# 1) Giris
$loginBody = New-Object System.Net.Http.StringContent('{"email":"admin@example.com","password":"LocalAdmin123!"}', [System.Text.Encoding]::UTF8, "application/json")
$loginResponse = $client.PostAsync("$baseUrl/api/v1/auth/login", $loginBody).GetAwaiter().GetResult()
Write-Host "Login status: $($loginResponse.StatusCode)"
if (-not $loginResponse.IsSuccessStatusCode) {
    Write-Host $loginResponse.Content.ReadAsStringAsync().GetAwaiter().GetResult()
    exit 1
}

# 2) Senaryo import
$form = New-Object System.Net.Http.MultipartFormDataContent
$stream = [System.IO.File]::Open($filePath, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read, [System.IO.FileShare]::ReadWrite)
$fileBytes = New-Object byte[] $stream.Length
$stream.Read($fileBytes, 0, $stream.Length) | Out-Null
$stream.Close()
$fileContent = New-Object System.Net.Http.ByteArrayContent(,$fileBytes)
$fileContent.Headers.ContentType = [System.Net.Http.Headers.MediaTypeHeaderValue]::Parse("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
$form.Add($fileContent, "file", "Servis_Adres_Formlari_ImportReady.xlsx")
$form.Add((New-Object System.Net.Http.StringContent("TOKİ Servis Güzergahı - Ağustos 2026")), "name")
$form.Add((New-Object System.Net.Http.StringContent("09:00:00")), "arrivalDeadline")
$form.Add((New-Object System.Net.Http.StringContent("1597. Cadde No:11, Çankaya, Ankara")), "destinationAddress")
$form.Add((New-Object System.Net.Http.StringContent("40")), "vehicleCount")

$importResponse = $client.PostAsync("$baseUrl/api/v1/scenarios/import", $form).GetAwaiter().GetResult()
Write-Host "Import status: $($importResponse.StatusCode)"
$body = $importResponse.Content.ReadAsStringAsync().GetAwaiter().GetResult()
Write-Host $body
