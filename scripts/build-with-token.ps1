# Posnic Build Script with GitHub Token
# This script sets the GH_TOKEN environment variable and builds the app

param(
    [Parameter(Mandatory=$true)]
    [string]$Token
)

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Posnic Build with GitHub Token" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# Set environment variable for this session
$env:GH_TOKEN = $Token
Write-Host "✓ GitHub token set" -ForegroundColor Green
Write-Host "  Token: $($Token.Substring(0,7))..." -ForegroundColor Gray
Write-Host ""

# Clean previous build
Write-Host "Cleaning previous build..." -ForegroundColor Yellow
Remove-Item -Path "dist" -Recurse -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 1
Write-Host "✓ Clean complete" -ForegroundColor Green
Write-Host ""

# Build
Write-Host "Building Posnic..." -ForegroundColor Yellow
npm run build

if ($LASTEXITCODE -eq 0) {
    Write-Host ""
    Write-Host "========================================" -ForegroundColor Green
    Write-Host "✓ Build successful!" -ForegroundColor Green
    Write-Host "========================================" -ForegroundColor Green
    Write-Host ""
    Write-Host "Installer created with embedded GitHub token" -ForegroundColor Cyan
    Write-Host "Users can now receive private repo updates automatically" -ForegroundColor Cyan
} else {
    Write-Host ""
    Write-Host "========================================" -ForegroundColor Red
    Write-Host "✗ Build failed!" -ForegroundColor Red
    Write-Host "========================================" -ForegroundColor Red
    exit 1
}
