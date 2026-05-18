# ──────────────────────────────────────────────────────────────
# deploy.ps1 — "1줄 명령" 안전 배포
#   predeploy-check.ps1 통과 시에만 firebase deploy 실행
#   사용법:  .\deploy.ps1
# ──────────────────────────────────────────────────────────────

$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot

& (Join-Path $root 'predeploy-check.ps1')
if ($LASTEXITCODE -ne 0) {
  Write-Host ""
  Write-Host "검사 실패로 배포하지 않았습니다. 위 [FAIL] 항목을 고친 뒤 다시 실행하세요." -ForegroundColor Red
  exit 1
}

Write-Host ""
Write-Host "=== Firebase 배포 시작 (hosting:hanger) ===" -ForegroundColor Cyan
firebase deploy --only hosting:hanger
if ($LASTEXITCODE -ne 0) {
  Write-Host "Firebase 배포 실패." -ForegroundColor Red
  exit 1
}

Write-Host ""
Write-Host "=== ✅ 배포 완료 ===" -ForegroundColor Green
