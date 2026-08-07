# Posnic Publish Script with GitHub Token
# This script sets the GH_TOKEN environment variable and publishes to GitHub

param(
    [Parameter(Mandatory=$true)]
    [string]$Token
)

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Posnic Publish to GitHub" -ForegroundColor Cyan
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

# Get version from package.json
$packageJson = Get-Content "package.json" | ConvertFrom-Json
$version = $packageJson.version
Write-Host "Publishing version: $version" -ForegroundColor Cyan
Write-Host ""

# Publish
Write-Host "Building and publishing to GitHub..." -ForegroundColor Yellow
npm run publish

if ($LASTEXITCODE -eq 0) {
    Write-Host ""
    Write-Host "========================================" -ForegroundColor Green
    Write-Host "✓ Publish successful!" -ForegroundColor Green
    Write-Host "========================================" -ForegroundColor Green
    Write-Host ""
    Write-Host "Version $version published to GitHub" -ForegroundColor Cyan
    Write-Host "Release URL: https://github.com/Posnic/installer/releases" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "Installer includes embedded GitHub token" -ForegroundColor Yellow
    Write-Host "Users will receive automatic updates from private repo" -ForegroundColor Yellow
} else {
    Write-Host ""
    Write-Host "========================================" -ForegroundColor Red
    Write-Host "✗ Publish failed!" -ForegroundColor Red
    Write-Host "========================================" -ForegroundColor Red
    exit 1
}
