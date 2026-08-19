$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Net.Http

$baseUrl = "http://localhost:8080"
$scenarioId = $args[0]

$handler = New-Object System.Net.Http.HttpClientHandler
$handler.CookieContainer = New-Object System.Net.CookieContainer
$client = New-Object System.Net.Http.HttpClient($handler)

$loginBody = New-Object System.Net.Http.StringContent('{"email":"admin@example.com","password":"LocalAdmin123!"}', [System.Text.Encoding]::UTF8, "application/json")
$loginResponse = $client.PostAsync("$baseUrl/api/v1/auth/login", $loginBody).GetAwaiter().GetResult()
if (-not $loginResponse.IsSuccessStatusCode) {
    Write-Host "Login failed: $($loginResponse.StatusCode)"
    exit 1
}

$getResponse = $client.GetAsync("$baseUrl/api/v1/scenarios/$scenarioId").GetAwaiter().GetResult()
Write-Host "Status code: $($getResponse.StatusCode)"
$body = $getResponse.Content.ReadAsStringAsync().GetAwaiter().GetResult()
Write-Host $body
