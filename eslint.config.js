// eslint.config.js — 루마네 저잡음 설정 (전역 eslint 전용, import 없음 / package.json 불필요)
// 목적: 진짜 버그(중복 키, 도달 불가 코드, const 재할당 등)만 error 로 잡고
//       스타일·미사용변수 같은 잔소리는 warn(우리 훅이 무시) 처리.
export default [
  {
    ignores: ["**/node_modules/**", "**/.git/**", "**/*.min.js", "**/dist/**", "**/build/**", "**/vendor/**"]
  },
  {
    files: ["**/*.js", "**/*.mjs", "**/*.cjs"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: {
        // 브라우저
        window: "readonly", document: "readonly", navigator: "readonly", location: "readonly",
        history: "readonly", localStorage: "readonly", sessionStorage: "readonly",
        fetch: "readonly", alert: "readonly", confirm: "readonly", prompt: "readonly",
        setTimeout: "readonly", clearTimeout: "readonly", setInterval: "readonly", clearInterval: "readonly",
        requestAnimationFrame: "readonly", FormData: "readonly", URL: "readonly", URLSearchParams: "readonly",
        Blob: "readonly", File: "readonly", FileReader: "readonly", XMLHttpRequest: "readonly",
        Event: "readonly", CustomEvent: "readonly", WebSocket: "readonly", Image: "readonly",
        atob: "readonly", btoa: "readonly", structuredClone: "readonly", AbortController: "readonly",
        // 공통
        console: "readonly", Promise: "readonly", globalThis: "readonly", queueMicrotask: "readonly",
        // Node / CommonJS
        require: "readonly", module: "readonly", exports: "readonly", process: "readonly",
        __dirname: "readonly", __filename: "readonly", Buffer: "readonly", global: "readonly",
        // Service Worker
        self: "readonly", caches: "readonly", clients: "readonly", importScripts: "readonly", skipWaiting: "readonly",
        // Firebase
        firebase: "readonly"
      }
    },
    rules: {
      // 거의 오탐 없는 진짜 버그 규칙만 error → 우리 훅이 차단
      "no-dupe-keys": "error",
      "no-dupe-args": "error",
      "no-unreachable": "error",
      "no-const-assign": "error",
      "no-func-assign": "error",
      "no-obj-calls": "error",
      "valid-typeof": "error",
      "use-isnan": "error",
      "no-cond-assign": ["error", "always"],
      "no-dupe-else-if": "error",
      "no-unsafe-negation": "error",
      // 정보성 — 우리 훅은 'error'만 차단하므로 평소엔 조용함
      "no-undef": "warn",
      "no-unused-vars": "warn"
    }
  }
];
