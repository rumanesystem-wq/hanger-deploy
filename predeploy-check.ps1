# ──────────────────────────────────────────────────────────────
# predeploy-check.ps1 — 배포 전 자동 검사 게이트
#   1) 발주앱/Functions JS 문법 검사 (node --check)
#   2) firebase.json hosting 경로 실제 존재 확인
#   3) version.txt 올렸는지 확인 (안 올렸으면 클라 자동 새로고침 안 됨)
# 하나라도 실패하면 exit 1 → deploy.ps1 이 배포 중단
# 기존 앱 코드는 한 줄도 건드리지 않음 (읽기 전용 검사 전용)
# ──────────────────────────────────────────────────────────────

$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
$fail = $false

function Pass($m){ Write-Host "  [OK]   $m" -ForegroundColor Green }
function Fail($m){ Write-Host "  [FAIL] $m" -ForegroundColor Red;  $script:fail = $true }
function Info($m){ Write-Host "  ·      $m" -ForegroundColor DarkGray }

Write-Host ""
Write-Host "=== 배포 전 검사 시작 ===" -ForegroundColor Cyan

# ── 1) JS 문법 검사 ──────────────────────────────────────────
Write-Host ""
Write-Host "[1/3] JS 문법 검사 (node --check)" -ForegroundColor Cyan

# 백업본·node_modules 는 배포에 안 실리므로 검사 제외 (깨져 있어도 무해 + 오탐 방지)
$jsFiles = Get-ChildItem -Path (Join-Path $root 'public\발주앱') -Recurse -Filter '*.js' -File |
  Where-Object {
    $_.FullName -notmatch '\\node_modules\\' -and
    $_.Name     -notmatch 'backup'
  }
$jsFiles += Get-ChildItem -Path (Join-Path $root 'functions\index.js') -File -ErrorAction SilentlyContinue

$checked = 0
foreach ($f in $jsFiles) {
  $out = & node --check $f.FullName 2>&1
  if ($LASTEXITCODE -ne 0) {
    Fail ("문법 오류: " + $f.FullName.Replace($root,'.'))
    Write-Host ("         " + ($out -join "`n         ")) -ForegroundColor DarkRed
  } else {
    $checked++
  }
}
if (-not $fail) { Pass "$checked 개 JS 파일 문법 정상" }

# ── 2) firebase.json hosting 경로 존재 확인 ──────────────────
Write-Host ""
Write-Host "[2/3] firebase.json hosting 경로 확인" -ForegroundColor Cyan

$fbPath = Join-Path $root 'firebase.json'
if (-not (Test-Path $fbPath)) {
  Fail "firebase.json 없음"
} else {
  try {
    $fb = Get-Content $fbPath -Raw -Encoding UTF8 | ConvertFrom-Json
    $hosting = $fb.hosting
    # hosting 이 배열일 수도 객체일 수도 있음 → 배열로 정규화
    $hostingList = @()
    if ($hosting -is [System.Array]) { $hostingList = $hosting } else { $hostingList = @($hosting) }
    foreach ($h in $hostingList) {
      $pub = $h.public
      if ([string]::IsNullOrWhiteSpace($pub)) { Fail "hosting.public 값이 비어있음"; continue }
      $pubFull = Join-Path $root $pub
      if (-not (Test-Path $pubFull -PathType Container)) {
        Fail "hosting.public 경로 없음: '$pub'  (코덱스가 깨졌다고 오진한 그 경로 — 실제로는 이 값이 맞아야 함)"
      } elseif (-not (Test-Path (Join-Path $pubFull 'index.html'))) {
        Fail "hosting.public 폴더에 index.html 없음: '$pub'"
      } else {
        Pass "hosting.public 정상: '$pub' (index.html 확인됨)"
      }
    }
  } catch {
    Fail "firebase.json 파싱 실패: $($_.Exception.Message)"
  }
}

# ── 3) version.txt 올렸는지 확인 ─────────────────────────────
Write-Host ""
Write-Host "[3/3] version.txt 갱신 여부 확인" -ForegroundColor Cyan

$verPath = Join-Path $root 'public\발주앱\version.txt'
if (-not (Test-Path $verPath)) {
  Fail "version.txt 없음"
} else {
  $curVer = (Get-Content $verPath -Raw).Trim()
  if ($curVer -notmatch '^\d+$') {
    Fail "version.txt 값이 숫자가 아님: '$curVer'"
  } else {
    Info "현재 version.txt = $curVer"
    # 직전 커밋(HEAD~1)의 version.txt 와 비교.
    # 코드(.js/.html/.css)는 바뀌었는데 version 이 그대로면 → 클라 자동 새로고침 안 됨 → FAIL
    Push-Location $root
    try {
      $prevVer = (& git show 'HEAD~1:public/발주앱/version.txt' 2>$null)
      if ($LASTEXITCODE -eq 0 -and $null -ne $prevVer) {
        $prevVer = ($prevVer | Out-String).Trim()
        $changed = (& git diff --name-only 'HEAD~1' 'HEAD' -- 'public/발주앱' 2>$null)
        $codeChanged = $false
        if ($changed) {
          foreach ($c in $changed) {
            if ($c -match '\.(js|html|css)$' -and $c -notmatch 'backup') { $codeChanged = $true; break }
          }
        }
        if ($codeChanged -and $curVer -eq $prevVer) {
          Fail "코드가 바뀌었는데 version.txt 가 $prevVer 그대로 — 올려야 클라가 자동 새로고침됨"
        } else {
          Pass "version.txt 갱신 상태 정상 (직전: $prevVer → 현재: $curVer)"
        }
      } else {
        Pass "직전 커밋 비교 불가 (첫 커밋/이력 부족) — version.txt 형식만 검증 완료"
      }
    } finally {
      Pop-Location
    }
  }
}

# ── 결과 ─────────────────────────────────────────────────────
Write-Host ""
if ($fail) {
  Write-Host "=== ❌ 검사 실패 — 배포 중단 ===" -ForegroundColor Red
  exit 1
} else {
  Write-Host "=== ✅ 검사 통과 — 배포 가능 ===" -ForegroundColor Green
  exit 0
}
