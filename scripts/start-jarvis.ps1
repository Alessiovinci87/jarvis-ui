<#
.SYNOPSIS
  Starts the whole Jarvis development environment with one command.

  1. Ollama        (http://127.0.0.1:11434)
  2. OpenJarvis    (uv run jarvis serve -a simple, http://127.0.0.1:8000)
  3. Action bridge (jarvis-bridge, http://127.0.0.1:8765)
  4. Jarvis UI     (npm run dev, http://localhost:5173)
  5. Health checks, then opens the UI in the default browser.

  Processes already listening on their port are left alone (no duplicates).
  PIDs of processes started here are recorded in .jarvis-run\pids.json so that
  stop-jarvis.ps1 only ever stops what this script started.

.PARAMETER NoBrowser
  Do not open the UI in the browser at the end.
#>
[CmdletBinding()]
param(
  [switch]$NoBrowser
)

$ErrorActionPreference = 'Stop'

$UiDir      = Split-Path -Parent $PSScriptRoot
$BackendDir = Join-Path (Split-Path -Parent $UiDir) 'OpenJarvis'
$BridgeDir  = Join-Path (Split-Path -Parent $UiDir) 'jarvis-bridge'
$RunDir     = Join-Path $UiDir '.jarvis-run'
$PidFile    = Join-Path $RunDir 'pids.json'

$Ports = @{ ollama = 11434; backend = 8000; bridge = 8765; ui = 5173 }
$UiUrl = "http://localhost:$($Ports.ui)"

New-Item -ItemType Directory -Force $RunDir | Out-Null

function Write-Step([string]$msg) { Write-Host "[jarvis] $msg" -ForegroundColor Cyan }
function Write-Ok([string]$msg)   { Write-Host "[jarvis]   OK  $msg" -ForegroundColor Green }
function Write-Warn2([string]$msg){ Write-Host "[jarvis]   !!  $msg" -ForegroundColor Yellow }

function Get-ListenerPid([int]$port) {
  $c = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($c) { return [int]$c.OwningProcess }
  return $null
}

function Wait-Http([string]$url, [int]$timeoutSec = 90) {
  $deadline = (Get-Date).AddSeconds($timeoutSec)
  while ((Get-Date) -lt $deadline) {
    try {
      $r = Invoke-WebRequest -UseBasicParsing -Uri $url -TimeoutSec 3
      if ($r.StatusCode -ge 200 -and $r.StatusCode -lt 500) { return $r }
    } catch { }
    Start-Sleep -Milliseconds 700
  }
  return $null
}

function Start-Component([string]$name, [string]$file, [string[]]$arguments, [string]$workdir) {
  $log = Join-Path $RunDir "$name.log"
  $err = Join-Path $RunDir "$name.err.log"
  $params = @{
    FilePath = $file; WorkingDirectory = $workdir; WindowStyle = 'Minimized'; PassThru = $true
    RedirectStandardOutput = $log; RedirectStandardError = $err
  }
  if ($arguments -and $arguments.Count -gt 0) { $params.ArgumentList = $arguments }
  $p = Start-Process @params
  return $p.Id
}

$started = @{}
$existing = @{}
if (Test-Path $PidFile) {
  try { $prev = Get-Content $PidFile -Raw | ConvertFrom-Json } catch { $prev = $null }
}

# ---------------------------------------------------------------- 1. Ollama
Write-Step 'Ollama'
$ollamaPid = Get-ListenerPid $Ports.ollama
if ($ollamaPid) {
  $existing.ollama = $ollamaPid
  Write-Ok "already running (pid $ollamaPid)"
} else {
  $ollama = (Get-Command ollama -ErrorAction SilentlyContinue).Source
  if (-not $ollama) { throw 'ollama.exe not found in PATH' }
  $started.ollama = Start-Component 'ollama' $ollama @('serve') $env:USERPROFILE
  if (-not (Wait-Http "http://127.0.0.1:$($Ports.ollama)/api/tags" 60)) { throw 'Ollama did not come up' }
  Write-Ok "started (pid $($started.ollama))"
}

# ------------------------------------------------------------- 2. OpenJarvis
Write-Step 'OpenJarvis backend'
$backendPid = Get-ListenerPid $Ports.backend
if ($backendPid) {
  $existing.backend = $backendPid
  Write-Ok "already listening on :$($Ports.backend) (pid $backendPid)"
} else {
  if (-not (Test-Path $BackendDir)) { throw "OpenJarvis not found at $BackendDir" }
  $uv = (Get-Command uv -ErrorAction SilentlyContinue).Source
  if (-not $uv) { throw 'uv.exe not found in PATH' }
  # Extras keep the venv in sync with what Jarvis needs: API server, Whisper STT, Kokoro TTS.
  $started.backend = Start-Component 'openjarvis' $uv @('run', '--extra', 'server', '--extra', 'speech', '--extra', 'voice', 'jarvis', 'serve', '-a', 'simple') $BackendDir
  Write-Ok "launching (pid $($started.backend))"
}

# ----------------------------------------------------------- 3. Action bridge
Write-Step 'Local action bridge'
$bridgePid = Get-ListenerPid $Ports.bridge
if ($bridgePid) {
  $existing.bridge = $bridgePid
  Write-Ok "already listening on :$($Ports.bridge) (pid $bridgePid)"
} elseif (Test-Path (Join-Path $BridgeDir '.venv\Scripts\jarvis-bridge.exe')) {
  $exe = Join-Path $BridgeDir '.venv\Scripts\jarvis-bridge.exe'
  $started.bridge = Start-Component 'bridge' $exe @() $BridgeDir
  Write-Ok "launching (pid $($started.bridge))"
} elseif (Test-Path $BridgeDir) {
  Write-Warn2 "bridge venv missing: run 'uv sync' in $BridgeDir (PC actions + offline wake word disabled)"
} else {
  Write-Warn2 "bridge not found at $BridgeDir (PC actions + offline wake word disabled)"
}

# ----------------------------------------------------------------- 4. UI
Write-Step 'Jarvis UI (Vite)'
$uiPid = Get-ListenerPid $Ports.ui
if ($uiPid) {
  $existing.ui = $uiPid
  Write-Ok "already listening on :$($Ports.ui) (pid $uiPid)"
} else {
  $npm = (Get-Command npm.cmd -ErrorAction SilentlyContinue).Source
  if (-not $npm) { $npm = (Get-Command npm -ErrorAction SilentlyContinue).Source }
  if (-not $npm) { throw 'npm not found in PATH' }
  $started.ui = Start-Component 'ui' $npm @('run', 'dev', '--', '--port', "$($Ports.ui)", '--strictPort') $UiDir
  Write-Ok "launching (pid $($started.ui))"
}

# Persist what we own (merge with previous file so repeated runs do not forget earlier PIDs).
$record = @{ startedAt = (Get-Date).ToString('o'); started = $started; existing = $existing }
if ($prev -and $prev.started) {
  foreach ($k in $prev.started.PSObject.Properties.Name) {
    if (-not $started.ContainsKey($k) -and (Get-Process -Id $prev.started.$k -ErrorAction SilentlyContinue)) {
      $record.started[$k] = $prev.started.$k
    }
  }
}
$record | ConvertTo-Json -Depth 4 | Set-Content -Encoding utf8 $PidFile

# ------------------------------------------------------------ 5. Health checks
Write-Step 'Health checks'
$h = Wait-Http "http://127.0.0.1:$($Ports.backend)/health" 120
if ($h) { Write-Ok "OpenJarvis  $($h.Content)" } else { Write-Warn2 'OpenJarvis health check failed (see .jarvis-run\openjarvis*.log)' }

try {
  $info = (Invoke-WebRequest -UseBasicParsing "http://127.0.0.1:$($Ports.backend)/v1/info" -TimeoutSec 5).Content | ConvertFrom-Json
  Write-Ok "model=$($info.model) agent=$($info.agent) engine=$($info.engine)"
} catch { }

if ($started.ContainsKey('bridge') -or $existing.ContainsKey('bridge')) {
  $b = Wait-Http "http://127.0.0.1:$($Ports.bridge)/health" 90
  if ($b) {
    $bj = $b.Content | ConvertFrom-Json
    $wake = if ($bj.wake.available) { 'offline wake word ready' } else { "wake word unavailable: $($bj.wake.reason)" }
    Write-Ok "bridge ok, $wake"
  } else { Write-Warn2 'bridge health check failed (see .jarvis-run\bridge*.log)' }
}

$u = Wait-Http $UiUrl 90
if ($u) { Write-Ok "UI $UiUrl" } else { Write-Warn2 'UI did not respond (see .jarvis-run\ui*.log)' }

# ------------------------------------------------------------------ 6. Open
# Only when the UI was started by this run: re-running the script to restart a backend
# component must not pile up browser tabs.
if (-not $NoBrowser -and $u -and $started.ui) {
  # Own window (Chrome/Edge "app" mode: no tabs, no address bar) when available; plain browser otherwise.
  $chrome = @("$env:ProgramFiles\Google\Chrome\Application\chrome.exe", "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
              "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe", "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe",
              "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe") | Where-Object { Test-Path $_ } | Select-Object -First 1
  if ($chrome) { Start-Process $chrome "--app=$UiUrl --window-size=1600,950" } else { Start-Process $UiUrl }
} elseif ($u -and $existing.ui) {
  Write-Ok "UI already open in the browser (not reopening)"
}
Write-Step "done. Stop with: powershell -File `"$PSScriptRoot\stop-jarvis.ps1`""
