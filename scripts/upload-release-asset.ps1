# Uploads VSIX assets to a GitHub release (existing release, by tag).
# Asks for the PAT hidden (SecureString), never echoed or written to disk.
#
# Usage:
#   pwsh ./scripts/upload-release-asset.ps1 -Tag v0.5.0 -Files releases/ollama-quota-tracker-0.5.0.vsix
#   pwsh ./scripts/upload-release-asset.ps1 -Tag v0.5.0 -Files a.vsix,b.vsix
#
# PAT needs the `repo` scope. Idempotent: an asset with the same name is
# deleted before the new upload (API does not support in-place replacement).

param(
  [Parameter(Mandatory = $true)]
  [string]$Tag,

  [Parameter(Mandatory = $true)]
  [string[]]$Files,

  [string]$Owner = "NicolasMalone",
  [string]$Repo = "ollama-quota-tracker"
)

$ErrorActionPreference = "Stop"

# --- Credentials (hidden prompt, minimal lifetime) -------------------------
$securePat = Read-Host -Prompt "GitHub PAT (scope repo)" -AsSecureString
$bstr = [System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($securePat)
try {
  $pat = [System.Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
} finally {
  [System.Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
}
if (-not $pat) {
  throw "No PAT provided."
}
$Headers = @{
  Authorization        = "Bearer $pat"
  "X-GitHub-Api-Version" = "2022-11-28"
  User-Agent           = "quota-tracker-release"
}
$pat = $null

function Invoke-GhApi {
  param([string]$Uri, [string]$Method = "GET", [object]$Body = $null, [string]$ContentType = "application/json")
  $args2 = @{ Uri = $Uri; Method = $Method; Headers = $Headers; ErrorAction = "Stop" }
  if ($Body) { $args2.Body = ($Body | ConvertTo-Json -Depth 5); $args2.ContentType = $ContentType }
  Invoke-RestMethod @args2
}

function Remove-ReleaseAsset {
  param([int]$ReleaseId, [string]$Name)
  $assets = Invoke-GhApi -Uri "https://api.github.com/repos/$Owner/$Repo/releases/$ReleaseId/assets"
  foreach ($a in $assets) {
    if ($a.name -eq $Name) {
      Write-Host "Deleting existing asset '$Name' (id $($a.id))..."
      Invoke-GhApi -Uri $a.url -Method DELETE | Out-Null
    }
  }
}

# --- Resolve the release ----------------------------------------------------
try {
  $release = Invoke-GhApi -Uri "https://api.github.com/repos/$Owner/$Repo/releases/tags/$Tag"
} catch {
  throw "Release with tag '$Tag' not found in $Owner/$Repo."
}
Write-Host "Release: $($release.name) (id $($release.id), draft=$($release.draft))"

foreach ($file in $Files) {
  if (-not (Test-Path -LiteralPath $file -PathType Leaf)) {
    Write-Warning "File not found, skipping: $file"
    continue
  }
  $name = [System.IO.Path]::GetFileName($file)
  Remove-ReleaseAsset -ReleaseId $release.id -Name $name

  # The upload host is uploads.github.com (different from api.github.com).
  $uploadUri = "https://uploads.github.com/repos/$Owner/$Repo/releases/$($release.id)/assets?name=$([uri]::EscapeDataString($name))"
  Write-Host "Uploading '$name' ($(Get-Item $file | Select-Object -ExpandProperty Length) bytes)..."
  $asset = Invoke-GhApi -Uri $uploadUri -Method POST -Body $null -ContentType "application/octet-stream" -InFile $file
  Write-Host "Uploaded: $($asset.browser_download_url)"
}

# --- Replace or merge into the release? (idempotent re-run safe) ------------


Write-Host "Done."