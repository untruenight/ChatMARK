// ============================================================
// utils/log.js — 로깅 유틸리티
// ============================================================
// 비유: "건물의 CCTV 녹화기". 문제가 생기면 여기 기록을 확인합니다.

import { ALLOWED_FRAME_ORIGINS } from './constants.js';

/**
 * 경고 메시지를 콘솔에 출력합니다.
 * 빈 catch 블록 대신 이 함수를 사용하세요.
 */
export function logWarn(label, error) {
  if (window.console && typeof window.console.warn === "function") {
    try {
      window.console.warn("[ChatMARKup]", label, error && error.message ? error.message : "");
    } catch (ignore) {}
  }
}

/**
 * 보안 제한된 postMessage.
 * 비유: "허가된 주소로만 편지를 보냄". "*"(모든 곳)이 아니라
 *       ALLOWED_FRAME_ORIGINS에 등록된 origin으로만 메시지를 전송합니다.
 */
export function safePostMessageToTarget(target, payload) {
  if (!target) {
    return;
  }

  var sent = false;
  ALLOWED_FRAME_ORIGINS.forEach(function (origin) {
    try {
      target.postMessage(payload, origin);
      sent = true;
    } catch (error) {}
  });

  if (!sent) {
    try {
      target.postMessage(payload, window.location.origin);
    } catch (error) {
      logWarn("postMessage failed for all origins", error);
    }
  }
}
