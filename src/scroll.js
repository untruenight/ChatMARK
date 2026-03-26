// ============================================================
// ui/scroll.js — 스크롤 트랜지션 (마스크 + 프로그레스 바)
// ============================================================
// 비유: "무대 전환 효과". 북마크 클릭 시 화면을 잠시 가리고,
//       목적지까지 스크롤한 뒤 부드럽게 보여주는 역할입니다.

import state from './state.js';

// ============================================================
// 내부 유틸
// ============================================================

function isTransparentColor(color) {
  return !color || color === "transparent" || color === "rgba(0, 0, 0, 0)" || color === "hsla(0, 0%, 0%, 0)";
}

function getScrollMaskColor() {
  const candidates = [
    document.querySelector("main"),
    document.body,
    document.documentElement
  ];

  for (let index = 0; index < candidates.length; index += 1) {
    const element = candidates[index];
    if (!element) {
      continue;
    }

    const color = window.getComputedStyle(element).backgroundColor;
    if (!isTransparentColor(color)) {
      return color;
    }
  }

  return "rgba(15, 23, 42, 0.98)";
}

export function waitForNextPaint() {
  return new Promise(function (resolve) {
    window.requestAnimationFrame(function () {
      resolve();
    });
  });
}

// ============================================================
// 프로그레스 바
// ============================================================

export function setScrollProgress(value) {
  const nextValue = Math.max(0, Math.min(1, Number(value) || 0));
  state.scrollProgressValue = nextValue;
  if (state.scrollProgressFill) {
    state.scrollProgressFill.style.transform = "scaleX(" + nextValue.toFixed(3) + ")";
  }
}

export function advanceScrollProgress(value) {
  setScrollProgress(Math.max(state.scrollProgressValue, value));
}

// ============================================================
// 스크롤 동작
// ============================================================

export function getOutputScrollBehavior(behavior) {
  if (state.hiddenScrollActive) {
    return "auto";
  }
  return behavior || "smooth";
}

// ============================================================
// 히든 스크롤 트랜지션
// ============================================================

export async function beginHiddenScrollTransaction() {
  if (!state.scrollMask) {
    return;
  }

  window.clearTimeout(state.scrollMaskRevealTimer);
  state.scrollMaskRevealTimer = 0;
  state.hiddenScrollActive = true;
  state.scrollMask.style.setProperty("--cgptbm-mask-bg", getScrollMaskColor());
  state.scrollMask.hidden = false;
  state.scrollMask.classList.remove("is-leaving");
  setScrollProgress(0.08);
  await waitForNextPaint();
  if (!state.scrollMask || !state.hiddenScrollActive) {
    return;
  }

  state.scrollMask.classList.add("is-active");
  advanceScrollProgress(0.26);
  await waitForNextPaint();
}

export function finishHiddenScrollTransaction() {
  if (!state.scrollMask) {
    state.hiddenScrollActive = false;
    return;
  }

  state.hiddenScrollActive = false;
  setScrollProgress(1);
  state.scrollMask.classList.add("is-leaving");
  state.scrollMask.classList.remove("is-active");
  window.clearTimeout(state.scrollMaskRevealTimer);
  state.scrollMaskRevealTimer = window.setTimeout(function () {
    state.scrollMaskRevealTimer = 0;
    if (state.scrollMask && !state.hiddenScrollActive) {
      state.scrollMask.hidden = true;
      state.scrollMask.classList.remove("is-leaving");
      setScrollProgress(0);
    }
  }, 150);
}

export function forceHideScrollTransaction() {
  window.clearTimeout(state.scrollMaskRevealTimer);
  state.scrollMaskRevealTimer = 0;
  state.hiddenScrollActive = false;
  if (!state.scrollMask) {
    return;
  }

  state.scrollMask.classList.remove("is-active", "is-leaving");
  state.scrollMask.hidden = true;
  setScrollProgress(0);
}
