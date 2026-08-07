param(
    [Parameter(Mandatory=$true)]
    [string]$Token
)

$Owner   = "Posnic"
$Repo    = "installer"
$Tag     = "v1.0.2"
$Headers = @{
    Authorization = "token $Token"
    Accept        = "application/vnd.github+json"
    "X-GitHub-Api-Version" = "2022-11-28"
}

Write-Host "Fetching release $Tag..." -ForegroundColor Cyan
$releases = Invoke-RestMethod -Uri "https://api.github.com/repos/$Owner/$Repo/releases" -Headers $Headers
$release  = $releases | Where-Object { $_.tag_name -eq $Tag } | Select-Object -First 1

if (-not $release) {
    Write-Host "ERROR: Release $Tag not found on GitHub." -ForegroundColor Red
    exit 1
}

Write-Host "Found release: $($release.name) (id=$($release.id))" -ForegroundColor Green

# Delete old assets
if ($release.assets.Count -gt 0) {
    Write-Host "Deleting $($release.assets.Count) old asset(s)..." -ForegroundColor Yellow
    foreach ($asset in $release.assets) {
        Write-Host "  Deleting: $($asset.name)"
        Invoke-RestMethod -Method Delete `
            -Uri "https://api.github.com/repos/$Owner/$Repo/releases/assets/$($asset.id)" `
            -Headers $Headers | Out-Null
    }
}

# Upload files
$uploads = @(
    @{ Path = "e:\projects\installer\dist\latest.yml";                  Name = "latest.yml";                       Type = "application/octet-stream" },
    @{ Path = "e:\projects\installer\dist\Posnic-Setup-1.0.2.exe"; Name = "Posnic-Setup-1.0.2.exe";       Type = "application/octet-stream" },
    @{ Path = "e:\projects\installer\dist\Posnic-Setup-1.0.2.exe.blockmap"; Name = "Posnic-Setup-1.0.2.exe.blockmap"; Type = "application/octet-stream" }
)

foreach ($file in $uploads) {
    if (-not (Test-Path $file.Path)) {
        Write-Host "  SKIP (not found): $($file.Name)" -ForegroundColor DarkGray
        continue
    }
    $size = (Get-Item $file.Path).Length
    Write-Host "Uploading $($file.Name) ($([math]::Round($size/1MB,1)) MB)..." -ForegroundColor Cyan
    $uploadUri = "https://uploads.github.com/repos/$Owner/$Repo/releases/$($release.id)/assets?name=$([Uri]::EscapeDataString($file.Name))"
    $uploadHeaders = $Headers.Clone()
    $uploadHeaders["Content-Type"] = $file.Type
    $result = Invoke-RestMethod -Method Post -Uri $uploadUri -Headers $uploadHeaders -InFile $file.Path
    Write-Host "  Uploaded: $($result.browser_download_url)" -ForegroundColor Green
}

Write-Host ""
Write-Host "All done! Release $Tag updated." -ForegroundColor Green
