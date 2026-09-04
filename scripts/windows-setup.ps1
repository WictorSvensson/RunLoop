# ============================================================================
#  Runloop - Windows Setup Script
# ============================================================================
#  This script installs everything the Runloop app needs and then starts it.
#  You do NOT need to understand any of this. Just run "START-HERE.bat".
#
#  It is safe to run this more than once. It only installs what is missing.
# ============================================================================

# Stop on unexpected errors so we can show a friendly message instead of a crash.
$ErrorActionPreference = "Stop"

# ----------------------------------------------------------------------------
#  Helper functions for nice, friendly, colourful messages
# ----------------------------------------------------------------------------
function Write-Title($text) {
    Write-Host ""
    Write-Host "============================================================" -ForegroundColor Cyan
    Write-Host "  $text" -ForegroundColor Cyan
    Write-Host "============================================================" -ForegroundColor Cyan
    Write-Host ""
}
function Write-Step($text)    { Write-Host "-> $text" -ForegroundColor White }
function Write-Ok($text)      { Write-Host "[OK]  $text" -ForegroundColor Green }
function Write-Info($text)    { Write-Host "[i]   $text" -ForegroundColor Yellow }
function Write-Problem($text) { Write-Host "[!]   $text" -ForegroundColor Red }

function Pause-AndExit($code) {
    Write-Host ""
    Write-Host "Press any key to close this window..." -ForegroundColor Gray
    try { $null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown") } catch { Start-Sleep -Seconds 30 }
    exit $code
}

# ----------------------------------------------------------------------------
#  Figure out where the project is (null-safe self path).
#  This script lives in <project>\scripts, so the project root is one level up.
# ----------------------------------------------------------------------------
$SelfPath = if ($PSCommandPath) { $PSCommandPath } else { $MyInvocation.MyCommand.Path }
$ScriptDir   = Split-Path -Parent $SelfPath
$ProjectRoot = Split-Path -Parent $ScriptDir
Set-Location $ProjectRoot

# A small marker file lets us remember we already did the install phase,
# so after the required restart the script knows to jump to "start the app".
$StateFile = Join-Path $ScriptDir ".setup-state"

# ----------------------------------------------------------------------------
#  Helper: is a command available on this machine right now?
#  (Defined early so we can decide between "first-time setup" and "just start".)
# ----------------------------------------------------------------------------
function Test-CommandExists($name) {
    return [bool](Get-Command $name -ErrorAction SilentlyContinue)
}

# Are all the required tools already installed? If so, this is an everyday run
# and we can skip installing (and skip the admin prompt entirely).
$ToolsAlreadyInstalled = (Test-CommandExists "git") -and `
                         (Test-CommandExists "node") -and `
                         (Test-CommandExists "docker")

# ----------------------------------------------------------------------------
#  STEP 0: Make sure we are running as Administrator - but ONLY if we actually
#  need to install something. Installing programs needs admin rights; just
#  starting the app does not. This avoids a scary admin popup on everyday runs.
# ----------------------------------------------------------------------------
$identity  = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = New-Object Security.Principal.WindowsPrincipal($identity)
$isAdmin   = $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)

if (-not $isAdmin -and -not $ToolsAlreadyInstalled) {
    Write-Title "Runloop Setup"
    Write-Info "This setup needs administrator permission to install programs."
    Write-Info "A Windows popup will appear - please click 'Yes'."
    Start-Sleep -Seconds 2
    try {
        # Relaunch this exact script, elevated, in the project's scripts folder.
        Start-Process -FilePath "powershell.exe" `
            -ArgumentList "-NoProfile -ExecutionPolicy Bypass -File `"$SelfPath`"" `
            -WorkingDirectory $ScriptDir `
            -Verb RunAs
    } catch {
        Write-Problem "You clicked 'No', or admin permission was denied."
        Write-Problem "Please run the setup again and click 'Yes' on the popup."
        Pause-AndExit 1
    }
    # The elevated window takes over from here; close this one.
    exit 0
}

if ($ToolsAlreadyInstalled) {
    Write-Title "Welcome back to Runloop!"
    Write-Host "Everything is already installed - just starting the app for you."
    Write-Host "This is quick. Your browser will open when it's ready."
    Write-Host ""
    Write-Host "Project folder: $ProjectRoot" -ForegroundColor Gray
    Start-Sleep -Seconds 1
} else {
    Write-Title "Welcome to the Runloop setup!"
    Write-Host "This will install everything you need and then start the app."
    Write-Host "It can take 10-20 minutes the first time. That is normal."
    Write-Host ""
    Write-Host "Project folder: $ProjectRoot" -ForegroundColor Gray
    Start-Sleep -Seconds 2
}

# ----------------------------------------------------------------------------
#  STEP 1: Check that Windows has 'winget' (the app installer).
#  winget ships with Windows 10 (recent updates) and Windows 11.
# ----------------------------------------------------------------------------
Write-Title "Step 1 of 6: Checking your Windows"

# We only need to install things if the tools aren't all present yet.
# On everyday runs this whole section is skipped.
$installedSomething = $false

if (-not $ToolsAlreadyInstalled) {

$wingetOk = [bool](Get-Command winget -ErrorAction SilentlyContinue)
if ($wingetOk) {
    winget --version 2>$null | Out-Null
    if ($LASTEXITCODE -ne 0) { $wingetOk = $false }
}

if (-not $wingetOk) {
    Write-Problem "Your Windows is missing 'winget', the app installer."
    Write-Info "To fix this, please do the following, then run the setup again:"
    Write-Info "  1. Open the 'Microsoft Store' app."
    Write-Info "  2. Search for 'App Installer'."
    Write-Info "  3. Click 'Update' or 'Get'."
    Write-Info "  4. Also run Windows Update (Start > Settings > Windows Update)."
    Pause-AndExit 1
}
Write-Ok "Windows is ready (winget found)."

# ----------------------------------------------------------------------------
#  Helper: install a winget package only if the command is not already there.
#  Returns $true if it installed something new (meaning a restart is wise).
# ----------------------------------------------------------------------------
function Install-IfMissing($displayName, $wingetId, $checkCommand) {
    if (Test-CommandExists $checkCommand) {
        Write-Ok "$displayName is already installed."
        return $false
    }
    Write-Step "Installing $displayName. Please wait (this can take a few minutes)..."
    winget install --exact --id $wingetId `
        --accept-source-agreements --accept-package-agreements `
        --silent --disable-interactivity | Out-Null

    if ($LASTEXITCODE -ne 0) {
        # Some winget exit codes mean "already installed / no upgrade" - treat as OK.
        Write-Info "$displayName installer finished with code $LASTEXITCODE (this is usually fine)."
    }
    Write-Ok "$displayName installed."
    return $true
}

# ----------------------------------------------------------------------------
#  STEP 2: Install Git, Node.js and Docker Desktop.
# ----------------------------------------------------------------------------
Write-Title "Step 2 of 6: Installing the tools"

# Git (used to download and manage code)
if (Install-IfMissing "Git" "Git.Git" "git") { $installedSomething = $true }

# Node.js LTS (runs the website)
if (Install-IfMissing "Node.js" "OpenJS.NodeJS.LTS" "node") { $installedSomething = $true }

# Docker Desktop (runs the database). Docker's command is "docker".
if (Install-IfMissing "Docker Desktop" "Docker.DockerDesktop" "docker") { $installedSomething = $true }

# ----------------------------------------------------------------------------
#  STEP 3: Turn on WSL2 (a Windows feature Docker needs to run).
# ----------------------------------------------------------------------------
Write-Title "Step 3 of 6: Preparing Docker's engine (WSL2)"
try {
    Write-Step "Enabling WSL2 (Docker needs this)..."
    wsl --install --no-distribution 2>$null | Out-Null
    Write-Ok "WSL2 is set up."
} catch {
    Write-Info "WSL2 may already be set up, or will finish after a restart. That's OK."
}

# ----------------------------------------------------------------------------
#  Make newly installed commands (like node/npm) usable in THIS window by
#  refreshing PATH from the registry. Some tools still need a restart, though.
# ----------------------------------------------------------------------------
$env:Path = `
    [System.Environment]::GetEnvironmentVariable("Path", "Machine") + ";" + `
    [System.Environment]::GetEnvironmentVariable("Path", "User")

} else {
    Write-Ok "All tools already installed - skipping installation."
}

# ----------------------------------------------------------------------------
#  DECISION POINT: If we just installed core tools, Windows almost always needs
#  a restart before Docker + Node work properly. Ask the user to restart, and
#  remember (via the marker file) that after restart we go straight to running.
# ----------------------------------------------------------------------------
$alreadyInstalledBefore = Test-Path $StateFile

if ($installedSomething -and -not $alreadyInstalledBefore) {
    New-Item -ItemType File -Path $StateFile -Force | Out-Null
    Write-Title "Almost there - please RESTART your computer"
    Write-Host "The tools are installed. Windows now needs a restart to finish." -ForegroundColor Yellow
    Write-Host ""
    Write-Host "  1. Restart your computer (Start > Power > Restart)."      -ForegroundColor White
    Write-Host "  2. After it starts up, WAIT until the little Docker whale" -ForegroundColor White
    Write-Host "     icon near the clock stops moving (it is 'starting')."   -ForegroundColor White
    Write-Host "  3. Then double-click 'START-HERE' again to finish."        -ForegroundColor White
    Write-Host ""
    Write-Info "You are halfway done - great job!"
    Pause-AndExit 0
}

# ============================================================================
#  SECOND RUN (after restart): set up the app and start it.
# ============================================================================

# ----------------------------------------------------------------------------
#  STEP 4: Make sure the database engine (Docker) is actually running.
#  Docker Desktop can take a minute to wake up after login. We wait for it.
# ----------------------------------------------------------------------------
Write-Title "Step 4 of 6: Starting the database engine"

function Test-DockerReady {
    try { docker info 2>$null | Out-Null; return ($LASTEXITCODE -eq 0) }
    catch { return $false }
}

if (-not (Test-CommandExists "docker")) {
    Write-Problem "Docker is not available yet."
    Write-Info "Please RESTART your computer, wait for the Docker whale icon"
    Write-Info "near the clock to stop moving, then run 'START-HERE' again."
    Pause-AndExit 1
}

if (-not (Test-DockerReady)) {
    Write-Step "Docker is waking up. Trying to open Docker Desktop..."
    $dockerExe = Join-Path $env:ProgramFiles "Docker\Docker\Docker Desktop.exe"
    if (Test-Path $dockerExe) { Start-Process $dockerExe | Out-Null }

    Write-Step "Waiting for Docker to be ready (up to 3 minutes)..."
    $waited = 0
    while (-not (Test-DockerReady) -and $waited -lt 180) {
        Start-Sleep -Seconds 5
        $waited += 5
        Write-Host "." -NoNewline -ForegroundColor Gray
    }
    Write-Host ""
}

if (-not (Test-DockerReady)) {
    if (Test-Path $StateFile) {
        # We just installed on a previous run. Docker needs a restart to work.
        Write-Problem "Docker isn't running yet - your computer needs a restart."
        Write-Info "Please RESTART your computer now. After it starts up, wait for"
        Write-Info "the whale icon near the clock to stop moving, then run START-HERE."
    } else {
        Write-Problem "Docker did not start in time."
        Write-Info "Open 'Docker Desktop' from the Start menu. The very first time,"
        Write-Info "you may need to accept its terms and let it finish starting."
        Write-Info "When the whale icon near the clock stops moving, run START-HERE again."
    }
    Pause-AndExit 1
}
Write-Ok "Docker is running."

# ----------------------------------------------------------------------------
#  STEP 5: Set up the project (settings file, install packages, database).
# ----------------------------------------------------------------------------
Write-Title "Step 5 of 6: Setting up the Runloop app"

# Create the settings file (.env) from the example if it does not exist.
$envFile     = Join-Path $ProjectRoot ".env"
$envExample  = Join-Path $ProjectRoot ".env.example"
if (-not (Test-Path $envFile)) {
    if (Test-Path $envExample) {
        Copy-Item $envExample $envFile
        Write-Ok "Created the settings file (.env)."
    } else {
        Write-Info "No .env.example found - skipping settings file."
    }
} else {
    Write-Ok "Settings file (.env) already exists."
}

# Helper: is a local TCP port already being used by another program?
function Test-PortInUse($port) {
    try { return [bool](Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue) }
    catch { return $false }
}

# Start the database container.
Write-Step "Starting the database (Docker Postgres)..."

# Port 5432 is the database's door. If another database is already using it,
# our container can't start - explain that clearly instead of a cryptic error.
if (Test-PortInUse 5432) {
    # It's only a problem if it's NOT our own container already running.
    docker ps --format "{{.Names}}" 2>$null | Select-String -Quiet "runloop-postgres" | Out-Null
    if (-not $?) {
        Write-Problem "Something else on your computer is already using the database port (5432)."
        Write-Info "You probably have another database (like PostgreSQL) running."
        Write-Info "Please close/stop it, then run START-HERE again."
        Pause-AndExit 1
    }
}

docker compose up -d
if ($LASTEXITCODE -ne 0) {
    Write-Problem "The database container failed to start."
    Write-Info "Make sure Docker Desktop is running (whale icon near the clock),"
    Write-Info "then close this window and run START-HERE again."
    Pause-AndExit 1
}
Write-Ok "Database is running."

# Install the app's code packages. We use a small 'done' marker so that a
# half-finished install (e.g. window closed mid-way) is repaired next time.
$nodeModules  = Join-Path $ProjectRoot "node_modules"
$installMarker = Join-Path $nodeModules ".runloop-install-done"
if ((Test-Path $nodeModules) -and (Test-Path $installMarker)) {
    Write-Ok "App packages already installed - skipping."
} else {
    Write-Step "Installing the app's packages (npm install). Please wait..."
    cmd /c "npm install"
    if ($LASTEXITCODE -ne 0) {
        Write-Problem "Installing packages failed (maybe the internet dropped?)."
        Write-Info "Please check your internet, then run START-HERE again."
        Pause-AndExit 1
    }
    New-Item -ItemType File -Path $installMarker -Force | Out-Null
    Write-Ok "Packages installed."
}

# Wait for the database to accept connections, then set up the tables.
Write-Step "Preparing the database tables..."
$dbWaited = 0
$dbReady  = $false
while (-not $dbReady -and $dbWaited -lt 60) {
    docker exec runloop-postgres pg_isready -U runloop -d runloop 2>$null | Out-Null
    if ($LASTEXITCODE -eq 0) { $dbReady = $true; break }
    Start-Sleep -Seconds 3
    $dbWaited += 3
}
if (-not $dbReady) {
    Write-Problem "The database didn't finish starting up in time."
    Write-Info "This is usually temporary. Please close this window and run"
    Write-Info "START-HERE again - it normally works on the second try."
    Pause-AndExit 1
}
cmd /c "npx prisma migrate deploy"
if ($LASTEXITCODE -ne 0) {
    Write-Problem "Setting up the database tables failed."
    Write-Info "Please close this window and run START-HERE again."
    Pause-AndExit 1
}
Write-Ok "Database tables are ready."

# ----------------------------------------------------------------------------
#  STEP 6: Start the app and open it in the browser.
# ----------------------------------------------------------------------------
Write-Title "Step 6 of 6: Starting Runloop!"

# Setup is fully complete - remove the marker so a future run behaves normally.
if (Test-Path $StateFile) { Remove-Item $StateFile -Force -ErrorAction SilentlyContinue }

# If port 3000 is already busy, Next.js will quietly use a different port and
# our "open the browser" link would point at the wrong place. Warn the user.
if (Test-PortInUse 3000) {
    Write-Info "Port 3000 is already in use (maybe the app is already open in"
    Write-Info "another window?). If the page looks wrong, close the other window."
}

Write-Host "The app is starting up. Your web browser will open automatically" -ForegroundColor White
Write-Host "at:  http://localhost:3000  (this can take up to a minute the"       -ForegroundColor White
Write-Host "first time while it gets everything ready)."                         -ForegroundColor White
Write-Host ""
Write-Info "To STOP the app later: just close this black window."
Write-Info "To START it again next time: double-click 'START-HERE'."
Write-Host ""

# Open the browser only once the app is actually answering, so the user never
# sees a "can't connect" page. We poll for up to ~2 minutes, then open anyway.
Start-Job -ScriptBlock {
    for ($i = 0; $i -lt 60; $i++) {
        Start-Sleep -Seconds 2
        try {
            Invoke-WebRequest "http://localhost:3000" -UseBasicParsing -TimeoutSec 2 | Out-Null
            Start-Process "http://localhost:3000"
            return
        } catch { }
    }
    # Fallback: open anyway after the timeout.
    Start-Process "http://localhost:3000"
} | Out-Null

# Run the development server (this keeps running until the window is closed).
cmd /c "npm run dev"

Write-Host ""
Write-Info "The app has stopped. You can close this window."
Pause-AndExit 0
