$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Net.Http

$baseUrl = "http://localhost:8080"
$jsonPath = Join-Path $env:USERPROFILE "Downloads\scenario_payload.json"

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

# 2) Senaryo olustur
$stream = [System.IO.File]::Open($jsonPath, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read, [System.IO.FileShare]::ReadWrite)
$reader = New-Object System.IO.StreamReader($stream, [System.Text.Encoding]::UTF8)
$jsonText = $reader.ReadToEnd()
$reader.Close()

$scenarioBody = New-Object System.Net.Http.StringContent($jsonText, [System.Text.Encoding]::UTF8, "application/json")
$createResponse = $client.PostAsync("$baseUrl/api/v1/scenarios", $scenarioBody).GetAwaiter().GetResult()
Write-Host "Create status: $($createResponse.StatusCode)"
$body = $createResponse.Content.ReadAsStringAsync().GetAwaiter().GetResult()
Write-Host $body
