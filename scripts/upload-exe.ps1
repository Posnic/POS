param([string]$Token)
$h = @{
    Authorization = "token $Token"
    Accept = "application/vnd.github+json"
    "X-GitHub-Api-Version" = "2022-11-28"
}
$owner = "Posnic"; $repo = "installer"; $releaseId = 331394021

$file = "e:\projects\installer\dist\Posnic-Setup-1.0.2.exe"
$name = "Posnic-Setup-1.0.2.exe"
$sz   = [math]::Round((Get-Item $file).Length / 1MB, 1)

Write-Host "Uploading $name ($sz MB) — may take a few minutes..." -ForegroundColor Cyan

# Use WebClient for large file (more reliable than Invoke-RestMethod for big uploads)
$wc = New-Object System.Net.WebClient
$wc.Headers.Add("Authorization", "token $Token")
$wc.Headers.Add("Content-Type",  "application/octet-stream")

$uri = "https://uploads.github.com/repos/$owner/$repo/releases/$releaseId/assets?name=$([Uri]::EscapeDataString($name))"

try {
    $resp = $wc.UploadFile($uri, "POST", $file)
    $json = [System.Text.Encoding]::UTF8.GetString($resp) | ConvertFrom-Json
    Write-Host "Uploaded: $($json.browser_download_url)" -ForegroundColor Green
} catch {
    Write-Host ('Upload failed: ' + $_.ToString()) -ForegroundColor Red
} finally {
    $wc.Dispose()
}
