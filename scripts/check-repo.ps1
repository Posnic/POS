param([string]$Token)
$h = @{ Authorization = "token $Token"; Accept = "application/vnd.github+json" }

# Try both owner paths
foreach ($owner in @("Posnic","satheeshposnic")) {
    Write-Host "Trying $owner/installer releases..." -ForegroundColor Cyan
    try {
        $rel = Invoke-RestMethod -Uri "https://api.github.com/repos/$owner/installer/releases" -Headers $h -ErrorAction Stop
        if ($rel.Count -gt 0) {
            $rel | ForEach-Object { Write-Host "  FOUND: tag=$($_.tag_name)  name=$($_.name)  id=$($_.id)" -ForegroundColor Green }
        } else {
            Write-Host "  No releases found (empty)" -ForegroundColor Yellow
        }
    } catch {
        $code = $_.Exception.Response.StatusCode.value__
        Write-Host "  Error $code : $_" -ForegroundColor Red
    }
}
