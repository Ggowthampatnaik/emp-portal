<#
    Starts the Trigyan Employee Portal locally, in two windows that stay open.

    Right-click -> "Run with PowerShell", or from a terminal:

        powershell -ExecutionPolicy Bypass -File tools\start-portal.ps1

    Two servers have to be up: Django on 8000 serves the API, and the SPA is
    served on 4173. The SPA proxies /api to 8000, so the backend going down
    looks like "Network Error" on every panel rather than an obvious failure -
    which is why this starts both together.

    -Dev switches the front end to the Vite dev server on 5173 (hot reload, for
    working on the code). The default builds once and serves the built bundle,
    which is what you want for a demo: nothing is fetched per navigation, so a
    hiccup cannot leave a tab half-loaded.

    -Background is for the scheduled task in install-autostart.ps1: no windows,
    no browser, output to logs\. Because this leaves both servers alone when
    their ports already answer, running it on a timer costs nothing and puts
    back whichever one has died - which is the whole of the watchdog.
#>

[CmdletBinding()]
param(
    [switch]$Dev,
    [switch]$SkipBuild,
    [switch]$Background
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$backend = Join-Path $root 'backend'
$frontend = Join-Path $root 'frontend'
$python = Join-Path $backend '.venv\Scripts\python.exe'
$logs = Join-Path $root 'logs'

if ($Background -and -not (Test-Path $logs)) {
    New-Item -ItemType Directory -Path $logs | Out-Null
}

# Start-Process refuses to send stdout and stderr to one file, so they are kept
# apart. Each start truncates them; restarts are rare enough that this is a log
# rather than something that needs rotating.
function Add-BackgroundOptions([hashtable]$Launch, [string]$Name) {
    $Launch.WindowStyle = 'Hidden'
    $Launch.RedirectStandardOutput = Join-Path $logs "$Name.out.log"
    $Launch.RedirectStandardError = Join-Path $logs "$Name.err.log"
    return $Launch
}

if (-not (Test-Path $python)) {
    throw "No virtualenv at $python. Create it: cd backend; python -m venv .venv; .venv\Scripts\pip install -r requirements/dev.txt"
}

# node lives here but the machine PATH entry has a trailing backslash, which
# Git Bash drops when handing PATH to the cmd children npm uses. Adding it
# without the slash makes `npm` work whatever shell this was started from.
$nodeDir = 'C:\Program Files\nodejs'
if ((Test-Path $nodeDir) -and ($env:Path -split ';' -notcontains $nodeDir)) {
    $env:Path = "$env:Path;$nodeDir"
}

function Test-Port([int]$Port) {
    try {
        $c = New-Object Net.Sockets.TcpClient
        $c.Connect('127.0.0.1', $Port)
        $c.Close()
        return $true
    } catch { return $false }
}

# Unattended, "is the port open" is the wrong question: a wedged server keeps
# its socket open, so a watchdog that only looks for a listener will leave it
# wedged for ever. Ask for an actual reply instead. Any HTTP status counts -
# the API answers a GET on the login endpoint with 405, and that is a server
# doing its job.
function Test-Answering([string]$Url) {
    try {
        $null = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 10
        return $true
    } catch [System.Net.WebException] {
        return $null -ne $_.Exception.Response
    } catch {
        return $false
    }
}

# Only ever aimed at whoever holds one of our two ports, and only once that
# port has failed to answer - a new server cannot bind over the old one, so
# leaving it there would mean the watchdog never recovers.
function Stop-Wedged([int]$Port) {
    $owner = (Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue).OwningProcess |
        Select-Object -First 1
    if ($owner) {
        Write-Host "  port $Port listening but not answering - stopping PID $owner"
        Stop-Process -Id $owner -Force -ErrorAction SilentlyContinue
        Start-Sleep -Seconds 2
    }
}

function Test-Up([int]$Port, [string]$Url) {
    if (-not (Test-Port $Port)) { return $false }
    if (-not $Background) { return $true }
    if (Test-Answering $Url) { return $true }
    Stop-Wedged $Port
    return $false
}

function Wait-Port([int]$Port, [string]$What, [int]$Seconds = 60) {
    Write-Host "  waiting for $What on port $Port " -NoNewline
    for ($i = 0; $i -lt $Seconds; $i++) {
        if (Test-Port $Port) { Write-Host " up"; return $true }
        Start-Sleep -Seconds 1
        Write-Host '.' -NoNewline
    }
    Write-Host " TIMED OUT"
    return $false
}

Write-Host ''
Write-Host 'Trigyan Employee Portal - starting locally' -ForegroundColor Cyan
Write-Host ''

# --- backend --------------------------------------------------------------
if (Test-Up 8000 'http://127.0.0.1:8000/api/v1/auth/login/') {
    Write-Host '  port 8000 already answering - leaving it alone'
} else {
    # --noreload when unattended: the file watcher is pointless for a server
    # nobody is editing against, and it makes the process tree two deep, so
    # "is it still up" stops being a question with one answer.
    $runserver = @('manage.py', 'runserver', '8000')
    if ($Background) { $runserver += '--noreload' }

    $launch = @{
        FilePath         = $python
        ArgumentList     = $runserver
        WorkingDirectory = $backend
    }
    if ($Background) { $launch = Add-BackgroundOptions $launch 'backend' }
    Start-Process @launch

    if (-not (Wait-Port 8000 'the API')) {
        throw 'The backend did not start. Look at the window it opened for the error.'
    }
}

# --- frontend -------------------------------------------------------------
$port = if ($Dev) { 5173 } else { 4173 }

if (Test-Up $port "http://127.0.0.1:$port/") {
    Write-Host "  port $port already answering - leaving it alone"
} else {
    # /k keeps the window open so a crash leaves its reason on screen; /c is
    # for the background task, where there is no screen and the reason goes to
    # the log instead.
    $keep = if ($Background) { '/c' } else { '/k' }

    if ($Dev) {
        $launch = @{
            FilePath         = 'cmd.exe'
            ArgumentList     = @($keep, 'npm run dev')
            WorkingDirectory = $frontend
        }
        if ($Background) { $launch = Add-BackgroundOptions $launch 'frontend' }
        Start-Process @launch
    } else {
        if (-not $SkipBuild) {
            Write-Host '  building the production bundle (about 20s) ...'
            Push-Location $frontend
            try {
                & npm run build 2>&1 | Select-Object -Last 3 | ForEach-Object { "    $_" }
                if ($LASTEXITCODE -ne 0) { throw 'npm run build failed - see the output above.' }
            } finally { Pop-Location }
        }
        $launch = @{
            FilePath         = 'cmd.exe'
            ArgumentList     = @($keep, 'npm run preview')
            WorkingDirectory = $frontend
        }
        if ($Background) { $launch = Add-BackgroundOptions $launch 'frontend' }
        Start-Process @launch
    }
    if (-not (Wait-Port $port 'the portal')) {
        throw 'The front end did not start. Look at the window it opened for the error.'
    }
}

# --- the addresses people actually type -----------------------------------
# "localhost" bare, and whichever of 5173/4173 this machine is not using
# today, all get a redirect to the real port instead of a refused connection.
# The helper binds only what is free and exits when there is nothing to do,
# so it cannot fight the dev server for 5173.
$other = if ($Dev) { 4173 } else { 5173 }
$launch = @{
    FilePath         = $python
    # Quoted by hand: Start-Process joins the array with spaces and no
    # quoting, and this path has a space in it.
    ArgumentList     = @("`"$(Join-Path $PSScriptRoot 'redirect_to_portal.py')`"",
                         '--target', $port, '--listen', 80, '--listen', $other)
    WorkingDirectory = $root
}
if ($Background) { $launch = Add-BackgroundOptions $launch 'redirect' }
else { $launch.WindowStyle = 'Hidden' }
Start-Process @launch

$url = "http://127.0.0.1:$port"

if ($Background) {
    Write-Host "Portal up on $url"
    return
}

Write-Host ''
Write-Host "  Portal   $url" -ForegroundColor Green
Write-Host '  API      http://127.0.0.1:8000/api/docs/'
Write-Host ''
Write-Host '  Sign in with any demo account and Portal@123, e.g.'
Write-Host '    asha.rao@trigyan.io     (employee)'
Write-Host '    priya.menon@trigyan.io  (HR)'
Write-Host '    vikram.nair@trigyan.io  (manager)'
Write-Host ''
Write-Host '  Both servers run in their own windows. Closing a window stops that server.'
Write-Host ''

Start-Process $url
