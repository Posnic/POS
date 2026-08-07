param([string]$Token)
$h = @{ Authorization = "token $Token"; Accept = "application/vnd.github+json" }

Write-Host "=== Tags in Posnic/installer ===" -ForegroundColor Cyan
try {
    $tags = Invoke-RestMethod -Uri "https://api.github.com/repos/Posnic/installer/tags" -Headers $h -ErrorAction Stop
    if ($tags.Count -eq 0) { Write-Host "  No tags found" -ForegroundColor Yellow }
    else { $tags | ForEach-Object { Write-Host "  tag: $($_.name)  sha: $($_.commit.sha)" } }
} catch { Write-Host "Error: $_" -ForegroundColor Red }

Write-Host ""
Write-Host "=== Repo info ===" -ForegroundColor Cyan
try {
    $repo = Invoke-RestMethod -Uri "https://api.github.com/repos/Posnic/installer" -Headers $h -ErrorAction Stop
    Write-Host "  Name: $($repo.full_name)  Private: $($repo.private)  Default branch: $($repo.default_branch)"
} catch { Write-Host "Error: $_" -ForegroundColor Red }
