param([string]$Token)
$h = @{
    Authorization = "token $Token"
    Accept = "application/vnd.github+json"
    "X-GitHub-Api-Version" = "2022-11-28"
}
$owner = "Posnic"; $repo = "installer"

# Get latest commit SHA
Write-Host "Getting latest commit..." -ForegroundColor Cyan
$branch = Invoke-RestMethod -Uri "https://api.github.com/repos/$owner/$repo/branches/main" -Headers $h
$sha = $branch.commit.sha
Write-Host "  SHA: $sha" -ForegroundColor Green

# Create release (creates tag automatically)
Write-Host "Creating release v1.0.2..." -ForegroundColor Cyan
$body = @{
    tag_name         = "v1.0.2"
    target_commitish = $sha
    name             = "Version 1.0.2"
    body             = "Posnic v1.0.2 - Software update mechanism improvements"
    draft            = $false
    prerelease       = $false
} | ConvertTo-Json

$release = Invoke-RestMethod -Method Post `
    -Uri "https://api.github.com/repos/$owner/$repo/releases" `
    -Headers $h -Body $body -ContentType "application/json"
Write-Host "  Release created: id=$($release.id)" -ForegroundColor Green

# Upload files
$files = @(
    @{ path="e:\projects\installer\dist\latest.yml";                         name="latest.yml" },
    @{ path="e:\projects\installer\dist\Posnic-Setup-1.0.2.exe";        name="Posnic-Setup-1.0.2.exe" },
    @{ path="e:\projects\installer\dist\Posnic-Setup-1.0.2.exe.blockmap"; name="Posnic-Setup-1.0.2.exe.blockmap" }
)

foreach ($f in $files) {
    if (-not (Test-Path $f.path)) { Write-Host "  SKIP: $($f.name)" -ForegroundColor DarkGray; continue }
    $sz = [math]::Round((Get-Item $f.path).Length / 1MB, 1)
    Write-Host "Uploading $($f.name) ($sz MB)..." -ForegroundColor Cyan
    $uri = "https://uploads.github.com/repos/$owner/$repo/releases/$($release.id)/assets?name=$([Uri]::EscapeDataString($f.name))"
    $up = Invoke-RestMethod -Method Post -Uri $uri -Headers $h `
        -InFile $f.path -ContentType "application/octet-stream"
    Write-Host "  Done: $($up.browser_download_url)" -ForegroundColor Green
}

Write-Host ""
Write-Host "Release URL: $($release.html_url)" -ForegroundColor Magenta
