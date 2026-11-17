$ErrorActionPreference = 'Stop'
$compose = Join-Path $PSScriptRoot 'demo/compose.yml'
docker compose -f $compose up -d
if ($LASTEXITCODE -ne 0) { throw 'Docker could not start the demo. Make sure Docker Desktop is running.' }

$url = 'http://127.0.0.1:8765'
$deadline = (Get-Date).AddMinutes(20)
Write-Host 'Waiting for the Rust API. The first build can take several minutes.'
while ((Get-Date) -lt $deadline) {
    try {
        $ready = Invoke-WebRequest -Uri "$url/ready" -TimeoutSec 3
        if ($ready.StatusCode -eq 204) {
            Start-Process $url
            Write-Host "Demo ready at $url"
            return
        }
    } catch {
        Start-Sleep -Seconds 2
    }
}
docker compose -f $compose logs --tail 40 app
throw 'The demo did not become ready.'
