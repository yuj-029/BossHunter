[CmdletBinding()]
param(
	[switch]$SkipChrome,
	[string]$PythonPath,
	[string]$ConfigPath,
	[int]$WebPort = 8686
)

$ErrorActionPreference = "Stop"
$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
Set-Location -LiteralPath $RepoRoot
if (-not $ConfigPath) {
	$WorkspaceRoot = Split-Path -Parent $RepoRoot
	$RealEnvironmentRoots = @(
		foreach ($Container in Get-ChildItem -LiteralPath $WorkspaceRoot -Directory) {
			$Candidate = Join-Path $Container.FullName "BossHunter"
			$CandidateConfig = Join-Path $Candidate "config.yaml"
			$CandidateData = Join-Path $Candidate "data\bosshunter.db"
			$CandidateProject = Join-Path $Candidate "pyproject.toml"
			if (
				(Test-Path -LiteralPath $CandidateConfig) -and
				(Test-Path -LiteralPath $CandidateData) -and
				(Test-Path -LiteralPath $CandidateProject) -and
				(Select-String -LiteralPath $CandidateProject -Pattern '^version\s*=\s*"2\.3\.0"' -Quiet)
			) {
				$Candidate
			}
		}
	)
	if ($RealEnvironmentRoots.Count -ne 1) {
		throw "Expected exactly one real 2.3.0 environment, found $($RealEnvironmentRoots.Count)."
	}
	$ConfigPath = Join-Path $RealEnvironmentRoots[0] "config.yaml"
}
if (-not (Test-Path -LiteralPath $ConfigPath)) {
	throw "Real environment config was not found: $ConfigPath"
}
if (-not $PythonPath) {
	$PythonPath = Join-Path $RepoRoot ".venv\Scripts\python.exe"
}


if ($PythonPath) {
	if (-not (Test-Path -LiteralPath $PythonPath)) {
		throw "Configured Python was not found: $PythonPath"
	}
	$Runner = (Resolve-Path -LiteralPath $PythonPath).Path
	$RunnerPrefix = @("-m", "bosshunter.main", "--config", $ConfigPath)
} else {
	$Bosshunter = Get-Command "bosshunter" -ErrorAction SilentlyContinue
	if ($Bosshunter) {
		$Runner = $Bosshunter.Source
		$RunnerPrefix = @()
	} else {
	$Python = Get-Command "py" -ErrorAction SilentlyContinue
	if (-not $Python) {
		$Python = Get-Command "python" -ErrorAction SilentlyContinue
	}
	if (-not $Python) {
		throw "Could not find BossHunter or Python. Install the project first with: pip install -e ."
	}
	$Runner = $Python.Source
	$RunnerPrefix = @("-m", "bosshunter.main")
	}
}

$ChromeCandidates = @()
if ($env:ProgramFiles) {
	$ChromeCandidates += Join-Path $env:ProgramFiles "Google\Chrome\Application\chrome.exe"
}
if (${env:ProgramFiles(x86)}) {
	$ChromeCandidates += Join-Path ${env:ProgramFiles(x86)} "Google\Chrome\Application\chrome.exe"
}
if ($env:LOCALAPPDATA) {
	$ChromeCandidates += Join-Path $env:LOCALAPPDATA "Google\Chrome\Application\chrome.exe"
}
$ChromeCandidates = $ChromeCandidates | Where-Object { $_ -and (Test-Path -LiteralPath $_) }

if (-not $ChromeCandidates) {
	throw "Could not find Google Chrome. Install Chrome or set up a compatible browser manually."
}

$Chrome = $ChromeCandidates | Select-Object -First 1
$ChromeArguments = @(
	"chrome://inspect/#remote-debugging",
	"https://www.zhipin.com"
	"https://we.51job.com"
)

if (-not $SkipChrome) {
	Write-Host "Opening the daily Chrome profile and remote-debugging permission page..."
	Start-Process -FilePath $Chrome -ArgumentList $ChromeArguments
}

$WebReady = $false
try {
	$null = Invoke-WebRequest -Uri "http://127.0.0.1:$WebPort/" -UseBasicParsing -TimeoutSec 2
	$WebReady = $true
} catch {
	Write-Host "Starting the local workbench..."
	$WebArguments = @($RunnerPrefix) + @("web", "--port", $WebPort, "--no-open")
	Start-Process -FilePath $Runner -ArgumentList $WebArguments -WorkingDirectory $RepoRoot -WindowStyle Hidden
}

for ($i = 0; -not $WebReady -and $i -lt 20; $i++) {
	Start-Sleep -Milliseconds 500
	try {
		$null = Invoke-WebRequest -Uri "http://127.0.0.1:$WebPort/" -UseBasicParsing -TimeoutSec 2
		$WebReady = $true
		break
	} catch {
		# The local server is still starting.
	}
}
if (-not $WebReady) {
	throw "BossHunter dashboard did not become ready at http://127.0.0.1:$WebPort."
}

Write-Host "Starting the Browser Runtime..."
& $Runner @RunnerPrefix "connect"
if ($LASTEXITCODE -ne 0) {
	Write-Warning "Browser connection is waiting for Chrome remote-debugging permission. The dashboard is already available."
}

if (-not $SkipChrome) {
	Start-Process -FilePath $Chrome -ArgumentList @(
		"http://127.0.0.1:$WebPort"
	)
}

Write-Host "BossHunter 2.3.2 is ready at http://127.0.0.1:$WebPort in the daily Chrome profile. Allow remote debugging in the opened Chrome settings page before collecting."
