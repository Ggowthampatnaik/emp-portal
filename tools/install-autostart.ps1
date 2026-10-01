<#
    Keeps the Trigyan Employee Portal running: at every logon, and again every
    few minutes in case something has died.

        powershell -ExecutionPolicy Bypass -File tools\install-autostart.ps1
        powershell -ExecutionPolicy Bypass -File tools\install-autostart.ps1 -Uninstall

    There is no service and no supervisor here, because there does not need to
    be one. start-portal.ps1 leaves a port alone when it already answers, so
    running it on a timer is free when everything is healthy and is a restart
    when it is not. The timer is what makes "always" true after a crash; the
    logon trigger is what makes it true after a reboot.

    Every minute rather than every few: the cost of a healthy check is one
    hidden PowerShell and two local HTTP requests, and the thing being bought
    is the length of time somebody can find the portal down.

    Runs as you, only while you are logged in - so it needs no administrator
    rights and holds no stored password. The flip side is that the portal is up
    when you are signed in to this machine, which is what a demo laptop wants.
    A machine that must serve while nobody is signed in wants a real deployment,
    not this.
#>

[CmdletBinding()]
param(
    [switch]$Uninstall,
    [switch]$Dev,
    [int]$EveryMinutes = 1
)

$ErrorActionPreference = 'Stop'

$TaskName = 'Trigyan Employee Portal'
$root = Split-Path -Parent $PSScriptRoot
$launcher = Join-Path $PSScriptRoot 'start-portal.ps1'

if ($Uninstall) {
    if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) {
        Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
        Write-Host "Removed the scheduled task. The servers already running are left alone;"
        Write-Host "close their windows, or reboot, to stop them."
    } else {
        Write-Host "Nothing to remove - no task named '$TaskName'."
    }
    return
}

if (-not (Test-Path $launcher)) { throw "No launcher at $launcher" }

$arguments = @(
    '-NoProfile'
    '-ExecutionPolicy', 'Bypass'
    '-WindowStyle', 'Hidden'
    '-File', "`"$launcher`""
    '-Background'
)
if ($Dev) { $arguments += '-Dev' }

$action = New-ScheduledTaskAction -Execute 'powershell.exe' `
    -Argument ($arguments -join ' ') -WorkingDirectory $root

# Two triggers doing two different jobs: one for coming back after a reboot,
# one for coming back after a crash. Omitting RepetitionDuration is what makes
# the second one repeat indefinitely rather than for a day.
$atLogon = New-ScheduledTaskTrigger -AtLogOn -User "$env:USERNAME"
$onTimer = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) `
    -RepetitionInterval (New-TimeSpan -Minutes $EveryMinutes)

# IgnoreNew matters: the launcher can sit for up to a minute waiting for a port,
# and a second copy starting on top of that would race it for the same one.
$settings = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
    -MultipleInstances IgnoreNew -StartWhenAvailable `
    -ExecutionTimeLimit ([TimeSpan]::Zero)

$principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" `
    -LogonType Interactive -RunLevel Limited

if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) {
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
}

Register-ScheduledTask -TaskName $TaskName `
    -Description 'Starts the portal at logon and restarts whichever server has stopped.' `
    -Action $action -Trigger @($atLogon, $onTimer) `
    -Settings $settings -Principal $principal | Out-Null

Write-Host ''
Write-Host "Registered '$TaskName'." -ForegroundColor Green
Write-Host "  at logon, and every $EveryMinutes minutes after that"
Write-Host "  logs in $root\logs"
Write-Host ''
Write-Host 'Starting it now ...'
Start-ScheduledTask -TaskName $TaskName

$port = if ($Dev) { 5173 } else { 4173 }
Write-Host "  the portal will be on http://127.0.0.1:$port"
Write-Host ''
Write-Host 'To stop it coming back:'
Write-Host "  powershell -ExecutionPolicy Bypass -File tools\install-autostart.ps1 -Uninstall"
Write-Host ''
