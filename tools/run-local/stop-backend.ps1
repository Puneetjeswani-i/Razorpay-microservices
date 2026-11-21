<#
.SYNOPSIS
  Stops everything start-backend.ps1 started: the services, the CORS proxy, the tunnel,
  and (unless -KeepInfra) the Docker containers. Data in PostgreSQL/Redis/Kafka is kept.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File tools\run-local\stop-backend.ps1
#>
param([switch]$KeepInfra)

$Here = $PSScriptRoot
$PidFile = Join-Path $Here "logs\pids.txt"

if (Test-Path $PidFile) {
    foreach ($line in Get-Content $PidFile) {
        $parts = $line -split " ", 2
        $procId = [int]$parts[0]
        $proc = Get-Process -Id $procId -ErrorAction SilentlyContinue
        if ($proc) {
            Stop-Process -Id $procId -Force -ErrorAction SilentlyContinue
            Write-Host "stopped $($parts[1]) (pid $procId)"
        }
    }
    Remove-Item $PidFile
} else {
    Write-Host "No running services recorded."
}

if (-not $KeepInfra) {
    if (Get-Command docker -ErrorAction SilentlyContinue) {
        docker compose -f (Join-Path $Here "docker-compose.yml") stop
    }
}
