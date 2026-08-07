param([string]$Token)
$h = @{ Authorization = "token $Token"; Accept = "application/vnd.github+json" }

Write-Host "Checking token..." -ForegroundColor Cyan
try {
    $u = Invoke-RestMethod -Uri "https://api.github.com/user" -Headers $h
    Write-Host "Token OK - User: $($u.login)" -ForegroundColor Green
} catch {
    Write-Host "Token INVALID or no access: $_" -ForegroundColor Red
}

Write-Host ""
Write-Host "Listing repos/releases..." -ForegroundColor Cyan
try {
    $rel = Invoke-RestMethod -Uri "https://api.github.com/repos/Posnic/installer/releases" -Headers $h
    $rel | ForEach-Object { Write-Host "  tag=$($_.tag_name)  name=$($_.name)  id=$($_.id)" }
} catch {
    Write-Host "Releases error: $_" -ForegroundColor Red
}
