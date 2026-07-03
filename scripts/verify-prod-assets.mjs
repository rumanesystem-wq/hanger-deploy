#!/usr/bin/env node
// 운영(또는 Preview) 자산이 올바른 MIME으로 응답하는지 검증
// 사용:
//   node scripts/verify-prod-assets.mjs              → 운영 검증
//   node scripts/verify-prod-assets.mjs preview      → Preview Channel 검증 (URL 입력 받음)
import https from 'node:https';

const isPreview = process.argv[2] === 'preview';
const BASE = isPreview
  ? (process.env.PREVIEW_URL || (() => {
      console.error('❌ Preview URL이 필요합니다.');
      console.error('   PREVIEW_URL 환경변수 또는 firebase hosting:channel:deploy 출력 URL 사용');
      process.exit(1);
    })())
  : 'https://hanger-deploy.web.app';

// 핵심 JS/CSS 자산이 진짜 그 MIME으로 응답하는지 확인
const ASSETS_TO_CHECK = [
  { path: '/qa-widget.js', mustStartWith: ['//', '(', '/*', 'const ', 'let ', 'function', 'window.', 'document.'] },
  { path: '/app.js', mustStartWith: ['//', '/*', 'const ', 'let ', 'function', 'window.', 'document.', 'if'] },
  { path: '/sw.js', mustStartWith: ['//', '/*', 'const ', 'self.'] },
  { path: '/style.css', mustStartWith: [':', '.', '@', '/', '*'] },
  { path: '/version.txt', mustStartWith: ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9'] },
];

function fetchHead(url) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = https.get({ hostname: u.hostname, path: u.pathname, port: 443 }, (res) => {
      let body = '';
      res.on('data', (chunk) => {
        body += chunk;
        if (body.length > 200) {
          req.destroy();
          resolve({ status: res.statusCode, head: body.slice(0, 200), contentType: res.headers['content-type'] });
        }
      });
      res.on('end', () => resolve({ status: res.statusCode, head: body.slice(0, 200), contentType: res.headers['content-type'] }));
    });
    req.on('error', reject);
    req.setTimeout(8000, () => { req.destroy(); reject(new Error('timeout')); });
  });
}

console.log(`🔍 자산 검증: ${BASE}\n`);
let failed = 0;
for (const asset of ASSETS_TO_CHECK) {
  try {
    const res = await fetchHead(BASE + asset.path);
    const head = (res.head || '').trim();
    const startsCorrect = asset.mustStartWith.some(p => head.startsWith(p));
    const isHtml = head.startsWith('<');
    if (res.status >= 400) {
      console.log(`❌ ${asset.path}  HTTP ${res.status}`);
      failed++;
    } else if (isHtml) {
      console.log(`❌ ${asset.path}  HTML로 응답됨 (rewrite/ignore 문제)`);
      console.log(`   첫 80자: ${head.slice(0, 80)}`);
      failed++;
    } else if (!startsCorrect) {
      console.log(`⚠️  ${asset.path}  예상 외 첫 글자`);
      console.log(`   첫 60자: ${head.slice(0, 60)}`);
    } else {
      console.log(`✅ ${asset.path}  OK (${res.contentType || '?'})`);
    }
  } catch (e) {
    console.log(`❌ ${asset.path}  실패: ${e.message}`);
    failed++;
  }
}

if (failed > 0) {
  console.log(`\n🚨 ${failed}개 자산 검증 실패 — 배포 중단 권장`);
  process.exit(1);
} else {
  console.log(`\n✓ 모든 자산 정상`);
}
