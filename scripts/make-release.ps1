# Creates the GitHub release for the current package.json version and uploads
# the VSIX from releases/ as the release asset.
#
# Usage:  & .\scripts\make-release.ps1
# The GitHub PAT (needs "repo" scope) is requested interactively and hidden.
#
#requires -Version 5.1
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
$pkg = Get-Content (Join-Path $root "package.json") -Raw | ConvertFrom-Json
$version = $pkg.version
$tag = "v$version"
$repo = "NicolasMalone/ollama-quota-tracker"
$asset = Join-Path $root "releases/ollama-quota-tracker-$version.vsix"
$changelog = Join-Path $root "CHANGELOG.md"

if (-not (Test-Path $asset)) {
  throw "VSIX not found: $asset (run 'npm run package' first)."
}

# Release notes: the first "## <version>" section of CHANGELOG.md.
$lines = Get-Content $changelog
$start = -1
for ($i = 0; $i -lt $lines.Count; $i++) {
  if ($lines[$i] -match "^## $([regex]::Escape($version))(\s|$)") { $start = $i; break }
}
if ($start -lt 0) { throw "No CHANGELOG entry for version $version." }
$end = $start + 1
while ($end -lt $lines.Count -and $lines[$end] -notmatch "^## ") { $end++ }
$notes = ($lines[($start + 1)..($end - 1)] -join "`n").Trim()

$pat = $null
$sec = Read-Host -AsSecureString "GitHub PAT (repo scope; input hidden)"
$ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec)
try {
  $pat = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr)
} finally {
  [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr)
}
if (-not $pat) { throw "No PAT provided." }

$headers = @{
  "Authorization" = "token $pat"
  "User-Agent"    = "ollama-quota-tracker-release"
  "Accept"        = "application/vnd.github+json"
}

$payload = @{
  tag_name         = $tag
  target_commitish = "main"
  name             = $tag
  body             = $notes
  draft            = $false
  prerelease       = $false
} | ConvertTo-Json
$bodyBytes = [System.Text.Encoding]::UTF8.GetBytes($payload)

Write-Host "Creating release $tag for $repo..."
try {
  $release = Invoke-RestMethod -Method Post `
    -Uri "https://api.github.com/repos/$repo/releases" `
    -Headers $headers -Body $bodyBytes -ContentType "application/json"
} catch {
  $code = 0
  try { $code = [int]$_.Exception.Response.StatusCode } catch { }
  if ($code -eq 422) { throw "A release for tag $tag already exists (HTTP 422)." }
  if ($code -eq 401) { throw "Invalid or expired PAT (HTTP 401)." }
  throw
}

Write-Host "Uploading asset $(Split-Path $asset -Leaf)..."
$uploadUrl = $release.upload_url.Split("{")[0] + "?name=$(Split-Path $asset -Leaf)"
Invoke-RestMethod -Method Post -Uri $uploadUrl -Headers $headers `
  -InFile $asset -ContentType "application/octet-stream" | Out-Null

$pat = $null
Write-Host "Release ready: $($release.html_url)"