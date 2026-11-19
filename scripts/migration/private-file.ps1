param([ValidateSet('protect','save','read')][string]$Mode, [string]$Path)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
Add-Type -AssemblyName System.Security
$workspace = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
$privateRoot = [IO.Path]::GetFullPath((Join-Path $workspace '.migration-private')) + [IO.Path]::DirectorySeparatorChar
$target = [IO.Path]::GetFullPath($Path)
if (-not $target.StartsWith($privateRoot, [StringComparison]::OrdinalIgnoreCase)) { throw 'Private file must stay inside the migration workspace.' }
$scope = [Security.Cryptography.DataProtectionScope]::CurrentUser
if ($Mode -eq 'protect' -or $Mode -eq 'save') {
  if ($Mode -eq 'save') { $original = [Text.Encoding]::UTF8.GetBytes([Console]::In.ReadToEnd()) }
  else { $original = [IO.File]::ReadAllBytes($target) }
  $encrypted = [Security.Cryptography.ProtectedData]::Protect($original, $null, $scope)
  $verified = [Security.Cryptography.ProtectedData]::Unprotect($encrypted, $null, $scope)
  if ([Convert]::ToBase64String($original) -ne [Convert]::ToBase64String($verified)) { throw 'Private file verification failed.' }
  [IO.File]::WriteAllBytes($target + '.dpapi', $encrypted)
  if ($Mode -eq 'protect') { Remove-Item -LiteralPath $target }
  Write-Output 'Private file protected and verified.'
} else {
  $clear = [Security.Cryptography.ProtectedData]::Unprotect([IO.File]::ReadAllBytes($target), $null, $scope)
  [Console]::Write([Text.Encoding]::UTF8.GetString($clear))
}
