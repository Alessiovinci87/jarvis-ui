<#
.SYNOPSIS
  Registers (or removes) a Scheduled Task that starts Jarvis at logon.

  The task runs start-jarvis.ps1 one minute after you log in, with the browser
  window opened in app mode. Nothing is registered until you run this script
  yourself: on a 16 GB laptop Ollama + Whisper at every login is a choice, not a default.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File .\scripts\install-autostart.ps1          # install
  powershell -ExecutionPolicy Bypass -File .\scripts\install-autostart.ps1 -Remove  # uninstall
#>
[CmdletBinding()]
param(
  [switch]$Remove,
  [switch]$NoBrowser
)

$TaskName = 'Jarvis (start at logon)'
$Start = Join-Path $PSScriptRoot 'start-jarvis.ps1'

if ($Remove) {
  if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) {
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
    Write-Host "[jarvis] task '$TaskName' removed"
  } else {
    Write-Host "[jarvis] task '$TaskName' not found"
  }
  exit
}

$args = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$Start`"" + $(if ($NoBrowser) { ' -NoBrowser' } else { '' })
$action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument $args -WorkingDirectory (Split-Path $PSScriptRoot -Parent)
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$trigger.Delay = 'PT1M'
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -ExecutionTimeLimit ([TimeSpan]::Zero)
Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Settings $settings -Force | Out-Null
Write-Host "[jarvis] task '$TaskName' registered: Jarvis starts ~1 min after logon. Remove with -Remove."
