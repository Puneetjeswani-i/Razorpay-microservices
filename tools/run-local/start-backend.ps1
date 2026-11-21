<#
.SYNOPSIS
  Starts the whole Razorpay microservices backend on this machine, optionally with a public
  HTTPS tunnel so the hosted dashboard's Live mode can connect to it.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File tools\run-local\start-backend.ps1 -Tunnel
  powershell -ExecutionPolicy Bypass -File tools\run-local\start-backend.ps1 -SkipBuild

  -Tunnel     also start the CORS proxy (:8090) and a Cloudflare quick tunnel, and print the URL
  -SkipBuild  reuse the jars from the last build
#>
param(
    [switch]$Tunnel,
    [switch]$SkipBuild
)

# Native tools (docker, mvnw) write progress to stderr; with "Stop" Windows PowerShell 5.1
# would treat that as fatal, so errors are checked explicitly below.
$ErrorActionPreference = "Continue"
$Here = $PSScriptRoot
$Root = (Resolve-Path (Join-Path $Here "..\..")).Path
$Logs = Join-Path $Here "logs"
$PidFile = Join-Path $Logs "pids.txt"
New-Item -ItemType Directory -Force $Logs | Out-Null

# Public config repo the services load their settings from (no credentials needed).
$ConfigRepo = "https://github.com/Anuj-Kumar-Sharma/distributed-razrorpay-config"

function Write-Step($msg) { Write-Host "`n==> $msg" -ForegroundColor Cyan }

function Test-Port([int]$Port) {
    $client = New-Object System.Net.Sockets.TcpClient
    try {
        $iar = $client.BeginConnect("127.0.0.1", $Port, $null, $null)
        $ok = $iar.AsyncWaitHandle.WaitOne(500)
        if ($ok) { $client.EndConnect($iar) }
        return $ok -and $client.Connected
    } catch { return $false } finally { $client.Close() }
}

function Wait-Port([string]$Name, [int]$Port, [int]$TimeoutSec = 240) {
    $deadline = (Get-Date).AddSeconds($TimeoutSec)
    while ((Get-Date) -lt $deadline) {
        if (Test-Port $Port) { Write-Host "    $Name is up on :$Port" -ForegroundColor Green; return }
        Start-Sleep -Seconds 2
    }
    throw "$Name did not start on port $Port within $TimeoutSec s. See $Logs\$Name.log"
}

# ---------------------------------------------------------------- Java 25
Write-Step "Finding JDK 25"
$jdk = Get-ChildItem "C:\Program Files\Eclipse Adoptium", "C:\Program Files\Java", "C:\Program Files\Microsoft" -Directory -ErrorAction SilentlyContinue |
    Where-Object { $_.Name -match '^jdk-25' } | Sort-Object Name | Select-Object -Last 1
if (-not $jdk) { throw "JDK 25 not found. Install it with: winget install --id EclipseAdoptium.Temurin.25.JDK -e" }
$env:JAVA_HOME = $jdk.FullName
$env:Path = "$($jdk.FullName)\bin;$env:Path"
$Java = Join-Path $jdk.FullName "bin\java.exe"
Write-Host "    Using $($jdk.FullName)"

# ---------------------------------------------------------------- Build
if (-not $SkipBuild) {
    Write-Step "Building (first build downloads dependencies and can take several minutes)"
    $order = "common-lib", "discovery-service", "config-service", "merchant-service", "vault-service",
             "payment-service", "operations-service", "api-gateway-service"
    foreach ($svc in $order) {
        Write-Host "    building $svc"
        Push-Location (Join-Path $Root $svc)
        try {
            if ($svc -eq "common-lib") { $goal = "install" } else { $goal = "package" }
            $log = Join-Path $Logs "build-$svc.log"
            # -Djib.skip: the poms push Docker images to a registry during package; not needed locally.
            cmd /c ".\mvnw.cmd -q -DskipTests -Djib.skip=true $goal > `"$log`" 2>&1"
            if ($LASTEXITCODE -ne 0) { throw "Build of $svc failed. See $log" }
        } finally { Pop-Location }
    }
}

# ---------------------------------------------------------------- Infrastructure
Write-Step "Starting PostgreSQL, Redis, Kafka and Zipkin (Docker)"
if (-not (Get-Command docker -ErrorAction SilentlyContinue)) { throw "Docker not found. Install Docker Desktop and start it." }
cmd /c "docker info >nul 2>&1"
if ($LASTEXITCODE -ne 0) { throw "Docker Desktop is not running. Start it from the Start menu, wait until it says 'running', then try again." }
docker compose -f (Join-Path $Here "docker-compose.yml") up -d
if ($LASTEXITCODE -ne 0) { throw "docker compose failed" }
Wait-Port "postgres" 5432 120
Wait-Port "redis" 6379 60
Wait-Port "kafka" 29092 120

# ---------------------------------------------------------------- Services
function Start-RzpService([string]$Name, [int]$Port, [string[]]$AppArgs = @()) {
    if (Test-Port $Port) { Write-Host "    $Name already running on :$Port" -ForegroundColor Yellow; return }
    $jar = Get-ChildItem (Join-Path $Root "$Name\target") -Filter "*.jar" -ErrorAction SilentlyContinue |
        Where-Object { $_.Name -notmatch "plain|original|sources" } | Select-Object -First 1
    if (-not $jar) { throw "No jar for $Name. Run without -SkipBuild." }
    $argList = @("-Xms128m", "-Xmx512m", "-jar", "`"$($jar.FullName)`"") + $AppArgs
    $p = Start-Process -FilePath $Java -ArgumentList $argList -WorkingDirectory (Join-Path $Root $Name) `
        -RedirectStandardOutput (Join-Path $Logs "$Name.log") -RedirectStandardError (Join-Path $Logs "$Name.err.log") `
        -WindowStyle Hidden -PassThru
    Add-Content $PidFile "$($p.Id) $Name"
    Write-Host "    started $Name (pid $($p.Id))"
}

# merchant-service needs webhook.secret-encryption-key (AES-256, Base64). The config repo's local
# profile misspells it as "webhoook", so supply it here. Generated once per machine and kept in a
# git-ignored file so webhook secrets encrypted earlier can still be decrypted.
$SecretsDir = Join-Path $Here ".secrets"
$WebhookKeyFile = Join-Path $SecretsDir "webhook-encryption.key"
if (-not (Test-Path $WebhookKeyFile)) {
    New-Item -ItemType Directory -Force $SecretsDir | Out-Null
    $bytes = New-Object byte[] 32
    [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
    Set-Content -Path $WebhookKeyFile -Value ([Convert]::ToBase64String($bytes)) -NoNewline -Encoding ascii
}
$WebhookKey = (Get-Content $WebhookKeyFile -Raw).Trim()

Write-Step "Starting services"
Start-RzpService "discovery-service" 8761
Wait-Port "discovery-service" 8761
Start-RzpService "config-service" 8888 @("--GIT_CONFIG_REPO=$ConfigRepo", "--GIT_USERNAME=", "--GIT_PASSWORD=")
Wait-Port "config-service" 8888
Start-RzpService "merchant-service" 9010 @("--webhook.secret-encryption-key=$WebhookKey")
Start-RzpService "vault-service" 9040
Wait-Port "merchant-service" 9010
Wait-Port "vault-service" 9040
Start-RzpService "payment-service" 9020
# Feign clients in operations-service and the gateway use ${MERCHANT_SERVICE_URI} with no default
# (Kubernetes sets it). Locally, point it straight at merchant-service.
$MerchantUri = "--MERCHANT_SERVICE_URI=http://localhost:9010"
Start-RzpService "operations-service" 9030 @($MerchantUri)
Wait-Port "payment-service" 9020
Wait-Port "operations-service" 9030
Start-RzpService "api-gateway-service" 8080 @($MerchantUri)
Wait-Port "api-gateway-service" 8080

Write-Host "`nBackend is running. API gateway: http://localhost:8080" -ForegroundColor Green
Write-Host "Eureka dashboard: http://localhost:8761   Zipkin: http://localhost:9411"
Write-Host "Services need ~30 s after start to register in Eureka before the gateway can route to them."

# ---------------------------------------------------------------- Tunnel for the hosted dashboard
if ($Tunnel) {
    Write-Step "Starting CORS proxy (:8090) and Cloudflare tunnel"
    $python = (Get-Command python -ErrorAction SilentlyContinue)
    if (-not $python) { throw "Python not found (needed for the CORS proxy)." }
    if (-not (Test-Port 8090)) {
        $p = Start-Process -FilePath $python.Source -ArgumentList @("`"$Root\tools\live-proxy\cors_proxy.py`"") `
            -RedirectStandardOutput (Join-Path $Logs "cors-proxy.log") -RedirectStandardError (Join-Path $Logs "cors-proxy.err.log") `
            -WindowStyle Hidden -PassThru
        Add-Content $PidFile "$($p.Id) cors-proxy"
    }
    Wait-Port "cors-proxy" 8090 30

    $cf = Get-Command cloudflared -ErrorAction SilentlyContinue
    if (-not $cf) {
        $cfPath = Get-ChildItem "C:\Program Files*\cloudflared\cloudflared.exe" -ErrorAction SilentlyContinue | Select-Object -First 1
        if ($cfPath) { $cfExe = $cfPath.FullName } else { throw "cloudflared not found. Install it with: winget install --id Cloudflare.cloudflared -e" }
    } else { $cfExe = $cf.Source }
    $cfLog = Join-Path $Logs "cloudflared.log"
    if (Test-Path $cfLog) { Remove-Item $cfLog }
    $p = Start-Process -FilePath $cfExe -ArgumentList @("tunnel", "--url", "http://localhost:8090") `
        -RedirectStandardOutput (Join-Path $Logs "cloudflared.out.log") -RedirectStandardError $cfLog -WindowStyle Hidden -PassThru
    Add-Content $PidFile "$($p.Id) cloudflared"

    $url = $null
    $deadline = (Get-Date).AddSeconds(60)
    while (-not $url -and (Get-Date) -lt $deadline) {
        Start-Sleep -Seconds 2
        if (Test-Path $cfLog) {
            $m = Select-String -Path $cfLog -Pattern "https://[a-z0-9-]+\.trycloudflare\.com" | Select-Object -First 1
            if ($m) { $url = $m.Matches[0].Value }
        }
    }
    if (-not $url) { throw "Could not read the tunnel URL. See $cfLog" }
    try { Set-Clipboard -Value $url } catch {}
    Write-Host "`nPublic gateway URL (copied to clipboard):" -ForegroundColor Green
    Write-Host "    $url" -ForegroundColor Green
    Write-Host "Open https://puneetjeswani-i.github.io/Razorpay-microservices/ , click Live, paste it and click Connect."
}

Write-Host "`nStop everything with: powershell -ExecutionPolicy Bypass -File tools\run-local\stop-backend.ps1"
