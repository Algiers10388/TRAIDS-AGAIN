# ==============================================================================
# FlashArb One-Click Runner for Windows PowerShell
# ==============================================================================
$ErrorActionPreference = "Stop"

Write-Host "=== [1/3] Checking Windows Foundry & Solidity ===" -ForegroundColor Cyan

# Check if solc is available locally
$solcCmd = Get-Command solc -ErrorAction SilentlyContinue

if (Test-Path "$PSScriptRoot\contracts") {
    Set-Location "$PSScriptRoot\contracts"
} else {
    Set-Location "$PSScriptRoot"
}

if ($solcCmd) {
    Write-Host "Found local Solidity compiler: $($solcCmd.Source)" -ForegroundColor Green
    Write-Host "=== [2/3] Compiling and Testing FlashArb Contracts ===" -ForegroundColor Cyan
    forge test --use $solcCmd.Source --fork-url https://arb1.arbitrum.io/rpc --fork-block-number 225000000 -vvv
} else {
    Write-Host "Running forge with default solc..." -ForegroundColor Yellow
    Write-Host "=== [2/3] Compiling and Testing FlashArb Contracts ===" -ForegroundColor Cyan
    forge test --fork-url https://arb1.arbitrum.io/rpc --fork-block-number 225000000 -vvv
}

Write-Host "=== [3/3] Launching Rust Searcher (Dry-Run Mode) ===" -ForegroundColor Cyan
if (Test-Path "$PSScriptRoot\searcher") {
    Set-Location "$PSScriptRoot\searcher"
} elseif (Test-Path "$PSScriptRoot\..\searcher") {
    Set-Location "$PSScriptRoot\..\searcher"
}

if (Get-Command cargo -ErrorAction SilentlyContinue) {
    cargo run --release -- --chains arbitrum --dry-run
} else {
    Write-Host "Cargo not found in PATH. Skipping searcher dry-run." -ForegroundColor Yellow
}
