// ============================================================
// 스냅샷 테스트 — storage 키 생성 함수의 출력 안정성 검증
// ============================================================
// 실행: node test/storage-key-stability.js
//
// 이 테스트가 실패하면 기존 사용자의 저장 데이터가 접근 불가능해집니다.
// 의도적 변경이 아닌 한 절대 기대값을 수정하지 마세요.

// ---- fingerprintRawText 복제 (src/text.js와 동일해야 함) ----
function fingerprintRawText(value) {
  const rawText = String(value || "");
  if (!rawText) return "";
  const sample = rawText.slice(0, 480);
  let hash = 2166136261;
  for (let index = 0; index < sample.length; index += 1) {
    hash ^= sample.charCodeAt(index);
    hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
  }
  return rawText.length + ":" + (hash >>> 0).toString(36);
}

// ---- fingerprintText 복제 (src/text.js와 동일해야 함) ----
function normalizeText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function fingerprintText(value) {
  const normalized = normalizeText(value).toLowerCase();
  if (!normalized) return "";
  const sample = normalized.slice(0, 320);
  let hash = 2166136261;
  for (let index = 0; index < sample.length; index += 1) {
    hash ^= sample.charCodeAt(index);
    hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
  }
  return normalized.length + ":" + (hash >>> 0).toString(36);
}

// ---- 테스트 케이스 ----
const FINGERPRINT_RAW_PAIRS = [
  ["https://chatgpt.com/c/abc-123-def", "33:1s5z8pk"],
  ["https://claude.ai/c/def-456-ghi", "31:alxmun"],
  ["https://gemini.google.com/c/jkl-789", "35:kuzs2i"],
  ["https://chat.openai.com/c/test-conv-id", "38:1bgtsjj"],
];

const FINGERPRINT_TEXT_PAIRS = [
  ["Hello World", "11:1n91413"],
  ["", ""],
];

// ---- 실행 ----
let passed = 0;
let failed = 0;

// fingerprintRawText 실제 기대값 먼저 보정
FINGERPRINT_RAW_PAIRS.forEach(function ([input, expected]) {
  const actual = fingerprintRawText(input);
  if (actual === expected) {
    passed += 1;
  } else {
    failed += 1;
    console.error("FAIL fingerprintRawText(\"" + input + "\")");
    console.error("  expected: " + expected);
    console.error("  actual:   " + actual);
  }
});

// fingerprintText 기대값 보정
FINGERPRINT_TEXT_PAIRS.forEach(function ([input, expected]) {
  const actual = fingerprintText(input);
  if (actual === expected) {
    passed += 1;
  } else {
    failed += 1;
    console.error("FAIL fingerprintText(\"" + input + "\")");
    console.error("  expected: " + expected);
    console.error("  actual:   " + actual);
  }
});

console.log("\nStorage key stability: " + passed + " passed, " + failed + " failed");

if (failed > 0) {
  console.error("\n⚠️  기존 사용자의 저장 데이터가 깨질 수 있습니다!");
  process.exit(1);
}
