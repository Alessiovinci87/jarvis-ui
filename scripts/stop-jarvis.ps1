<#
.SYNOPSIS
  Stops the Jarvis components that start-jarvis.ps1 started.

  Only PIDs recorded in .jarvis-run\pids.json under "started" are touched, and
  each one is checked against the expected command line before being stopped,
  so processes that were already running (or belong to something else) are
  never killed. Child processes (python under uv, node under npm) are included.

.PARAMETER All
  Also stop listeners on the Jarvis ports that this script did not start, but
  only when their command line clearly identifies them as Jarvis components.
  Ollama is never stopped by this script.
#>
[CmdletBinding()]
param(
  [switch]$All
)

$UiDir   = Split-Path -Parent $PSScriptRoot
$RunDir  = Join-Path $UiDir '.jarvis-run'
$PidFile = Join-Path $RunDir 'pids.json'

# What a legitimate Jarvis process command line must contain, per component.
$Signature = @{
  backend = @('jarvis', 'serve')
  bridge  = @('jarvis-bridge', 'jarvis_bridge')
  ui      = @('vite', 'jarvis-ui')
}
$Ports = @{ backend = 8000; bridge = 8765; ui = 5173 }

function Get-Proc([int]$id) { Get-CimInstance Win32_Process -Filter "ProcessId=$id" -ErrorAction SilentlyContinue }

function Get-Tree([int]$id) {
  $out = @()
  $queue = @($id)
  while ($queue.Count -gt 0) {
    $cur = $queue[0]; $queue = $queue[1..$queue.Count]
    $out += $cur
    $children = Get-CimInstance Win32_Process -Filter "ParentProcessId=$cur" -ErrorAction SilentlyContinue
    foreach ($c in $children) { $queue += [int]$c.ProcessId }
  }
  return $out
}

function Test-Signature($proc, [string[]]$needles) {
  if (-not $proc) { return $false }
  $cl = "$($proc.CommandLine) $($proc.ExecutablePath)".ToLower()
  foreach ($n in $needles) { if ($cl.Contains($n.ToLower())) { return $true } }
  return $false
}

function Stop-Component([string]$name, [int]$id) {
  $root = Get-Proc $id
  if (-not $root) { Write-Host "[jarvis] $name (pid $id) already gone"; return }
  $tree = Get-Tree $id
  $matched = $false
  foreach ($p in $tree) { if (Test-Signature (Get-Proc $p) $Signature[$name]) { $matched = $true; break } }
  if (-not $matched -and $name -ne 'ollama') {
    Write-Host "[jarvis] $name (pid $id): command line does not look like Jarvis, skipping" -ForegroundColor Yellow
    return
  }
  foreach ($p in ($tree | Sort-Object -Descending)) {
    try { Stop-Process -Id $p -Force -ErrorAction Stop; Write-Host "[jarvis] stopped $name pid $p" } catch { }
  }
}

$record = $null
if (Test-Path $PidFile) { try { $record = Get-Content $PidFile -Raw | ConvertFrom-Json } catch { } }

if ($record -and $record.started) {
  foreach ($k in $record.started.PSObject.Properties.Name) {
    if ($k -eq 'ollama') { Write-Host "[jarvis] leaving Ollama running (pid $($record.started.$k))"; continue }
    Stop-Component $k ([int]$record.started.$k)
  }
  Remove-Item $PidFile -Force -ErrorAction SilentlyContinue
} else {
  Write-Host '[jarvis] no pids.json: nothing started by start-jarvis.ps1 is tracked'
}

if ($All) {
  foreach ($k in $Ports.Keys) {
    $c = Get-NetTCPConnection -LocalPort $Ports[$k] -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
    if (-not $c) { continue }
    $id = [int]$c.OwningProcess
    # Walk up a couple of parents: the listener may be python/node under uv/npm.
    $candidates = @($id)
    $p = Get-Proc $id
    for ($i = 0; $i -lt 2 -and $p; $i++) { $candidates += [int]$p.ParentProcessId; $p = Get-Proc ([int]$p.ParentProcessId) }
    $hit = $null
    foreach ($cand in $candidates) { if (Test-Signature (Get-Proc $cand) $Signature[$k]) { $hit = $cand; break } }
    if ($hit) { Stop-Component $k $hit } else { Write-Host "[jarvis] port $($Ports[$k]) owned by pid $id, not a Jarvis process: left alone" -ForegroundColor Yellow }
  }
}
Write-Host '[jarvis] stop complete'
