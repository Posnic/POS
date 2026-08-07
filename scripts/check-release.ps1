param([string]$Token)
$h = @{ Authorization = "token $Token"; Accept = "application/vnd.github+json" }
$owner = "Posnic"; $repo = "installer"

# Try specific tag
foreach ($tag in @("v1.0.2","1.0.2","v1.0.1","v2")) {
    try {
        $r = Invoke-RestMethod -Uri "https://api.github.com/repos/$owner/$repo/releases/tags/$tag" -Headers $h -ErrorAction Stop
        Write-Host "FOUND by tag '$tag': id=$($r.id) name=$($r.name) draft=$($r.draft) prerelease=$($r.prerelease)" -ForegroundColor Green
        Write-Host "  Assets: $($r.assets.Count)"
        $r.assets | ForEach-Object { Write-Host "    - $($_.name)" }
    } catch {
        $code = $_.Exception.Response.StatusCode.value__
        Write-Host "tag '$tag' -> $code" -ForegroundColor DarkGray
    }
}
