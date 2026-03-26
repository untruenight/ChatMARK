// ============================================================
// ui/selection.js — 텍스트 선택 트리거 UI + 북마크 흐름 시작
// ============================================================
// 비유: "형광펜 꺼내기 버튼". 사용자가 텍스트를 선택하면 나타나는
//       MARK 버튼과 관련 위치 계산, 북마크 저장 흐름 시작을 담당합니다.

import state from './state.js';
import {
  SELECTION_TRIGGER_WIDTH,
  SELECTION_TRIGGER_HEIGHT,
  SELECTION_POPUP_WIDTH,
  SELECTION_POPUP_HEIGHT,
  SELECTION_UI_GAP,
  SELECTION_UI_VIEWPORT_GAP,
  SELECTION_UI_BLOCKER_SAFE_GAP,
  SELECTION_UI_BLOCKER_NEARBY_VERTICAL_GAP,
  SELECTION_UI_BLOCKER_NEARBY_HORIZONTAL_GAP,
  SELECTION_UI_BLOCKER_MIN_WIDTH,
  SELECTION_UI_BLOCKER_MIN_HEIGHT,
  SELECTION_UI_BLOCKER_SELECTOR
} from './constants.js';
import { normalizeText, clamp } from './text.js';
import { captureAnchor } from './capture.js';
import { isFrameRelayAnchor } from './bridge.js';
import { isSandboxCardAnchor, captureClaudeSandboxCardAnchor } from './sandbox-card.js';

// ---- 콜백 주입 (순환 의존 방지) ----
// popup.js (popup ↔ selection 순환 방지)
let _openSavePopup = null;

export function setSelectionCallbacks(callbacks) {
  _openSavePopup = callbacks.openSavePopup || null;
}

// ============================================================
// Selection 요소 헬퍼
// ============================================================

export function getSelectionElement(selection) {
  if (!selection || selection.rangeCount < 1) {
    return null;
  }

  const node = selection.getRangeAt(0).startContainer;
  return node && node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
}

function isTextEditableInputElement(element) {
  if (!element || !(element instanceof HTMLInputElement)) {
    return false;
  }

  const type = String(element.type || "text").toLowerCase();
  return [
    "button",
    "checkbox",
    "color",
    "file",
    "hidden",
    "image",
    "radio",
    "range",
    "reset",
    "submit"
  ].indexOf(type) < 0;
}

export function isEditableTextSelectionTarget(element) {
  if (!element || !(element instanceof Element)) {
    return false;
  }
  if (state.root && state.root.contains(element)) {
    return false;
  }

  if (element.closest("textarea")) {
    return true;
  }

  const input = element.closest("input");
  if (isTextEditableInputElement(input)) {
    return true;
  }

  return Boolean(element.closest([
    "[contenteditable]:not([contenteditable='false'])",
    "[role='textbox']",
    "[aria-multiline='true']",
    "[data-lexical-editor='true']",
    "[data-slate-editor='true']",
    ".ProseMirror",
    ".ql-editor"
  ].join(", ")));
}

export function isSelectionInsideEditableTextSurface(selection) {
  if (!selection || selection.isCollapsed || selection.rangeCount < 1) {
    return false;
  }

  return isEditableTextSelectionTarget(getSelectionElement(selection));
}

// ============================================================
// Selection 방향 / 클라이언트 Rect
// ============================================================

function isSelectionBackward(selection) {
  if (!selection || selection.isCollapsed || selection.rangeCount < 1) {
    return false;
  }

  const anchorNode = selection.anchorNode;
  const focusNode = selection.focusNode;
  if (!anchorNode || !focusNode) {
    return false;
  }

  if (anchorNode === focusNode) {
    return selection.focusOffset < selection.anchorOffset;
  }

  const position = anchorNode.compareDocumentPosition(focusNode);
  return Boolean(position & Node.DOCUMENT_POSITION_PRECEDING);
}

export function getSelectionClientRect(selection) {
  if (!selection || selection.rangeCount < 1) {
    return null;
  }

  const range = selection.getRangeAt(0);
  const rects = Array.from(range.getClientRects()).filter(function (rect) {
    return rect && (rect.width > 0 || rect.height > 0);
  });
  const isBackward = isSelectionBackward(selection);
  const rect = (isBackward ? rects[0] : rects[rects.length - 1]) || range.getBoundingClientRect();

  if (!rect || (!rect.width && !rect.height)) {
    return null;
  }

  return {
    top: rect.top,
    right: rect.right,
    bottom: rect.bottom,
    left: rect.left,
    width: rect.width,
    height: rect.height,
    isBackward: isBackward
  };
}

// ============================================================
// UI 위치 계산 (트리거 + 팝업)
// ============================================================

function expandRect(rect, padding) {
  if (!rect) {
    return null;
  }

  return {
    left: rect.left - padding,
    top: rect.top - padding,
    right: rect.right + padding,
    bottom: rect.bottom + padding
  };
}

function getRectOverlapArea(a, b) {
  if (!a || !b) {
    return 0;
  }

  const overlapWidth = Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left));
  const overlapHeight = Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
  return overlapWidth * overlapHeight;
}

function getSelectionUiBlockerRects(selectionRect) {
  if (!selectionRect) {
    return [];
  }

  const candidates = Array.from(document.querySelectorAll(SELECTION_UI_BLOCKER_SELECTOR));
  const rects = [];
  const seen = new Set();

  candidates.forEach(function (candidate) {
    if (!(candidate instanceof HTMLElement)) {
      return;
    }
    if (state.root && state.root.contains(candidate)) {
      return;
    }

    const style = window.getComputedStyle(candidate);
    if (
      style.display === "none" ||
      style.visibility === "hidden" ||
      style.pointerEvents === "none" ||
      Number.parseFloat(style.opacity || "1") <= 0.01
    ) {
      return;
    }

    if (!["fixed", "absolute", "sticky"].includes(style.position)) {
      return;
    }

    const rect = candidate.getBoundingClientRect();
    if (
      rect.width < SELECTION_UI_BLOCKER_MIN_WIDTH ||
      rect.height < SELECTION_UI_BLOCKER_MIN_HEIGHT ||
      rect.bottom <= 0 ||
      rect.right <= 0 ||
      rect.top >= window.innerHeight ||
      rect.left >= window.innerWidth
    ) {
      return;
    }

    if (
      rect.bottom < selectionRect.top - SELECTION_UI_BLOCKER_NEARBY_VERTICAL_GAP ||
      rect.top > selectionRect.bottom + SELECTION_UI_BLOCKER_NEARBY_VERTICAL_GAP ||
      rect.right < selectionRect.left - SELECTION_UI_BLOCKER_NEARBY_HORIZONTAL_GAP ||
      rect.left > selectionRect.right + SELECTION_UI_BLOCKER_NEARBY_HORIZONTAL_GAP
    ) {
      return;
    }

    const key = [
      Math.round(rect.left),
      Math.round(rect.top),
      Math.round(rect.width),
      Math.round(rect.height)
    ].join(":");
    if (seen.has(key)) {
      return;
    }
    seen.add(key);

    rects.push({
      left: rect.left,
      top: rect.top,
      right: rect.right,
      bottom: rect.bottom
    });
  });

  return rects;
}

function buildSelectionUiCandidatePosition(rect, vertical, horizontal) {
  if (!rect) {
    return null;
  }

  const triggerTop = vertical === "above"
    ? clamp(
      rect.top - SELECTION_TRIGGER_HEIGHT - SELECTION_UI_GAP,
      SELECTION_UI_VIEWPORT_GAP,
      window.innerHeight - SELECTION_TRIGGER_HEIGHT - SELECTION_UI_VIEWPORT_GAP
    )
    : clamp(
      rect.bottom + SELECTION_UI_GAP,
      SELECTION_UI_VIEWPORT_GAP,
      window.innerHeight - SELECTION_TRIGGER_HEIGHT - SELECTION_UI_VIEWPORT_GAP
    );
  const triggerLeft = horizontal === "left"
    ? clamp(
      rect.left,
      SELECTION_UI_VIEWPORT_GAP,
      window.innerWidth - SELECTION_TRIGGER_WIDTH - SELECTION_UI_VIEWPORT_GAP
    )
    : clamp(
      rect.right - SELECTION_TRIGGER_WIDTH,
      SELECTION_UI_VIEWPORT_GAP,
      window.innerWidth - SELECTION_TRIGGER_WIDTH - SELECTION_UI_VIEWPORT_GAP
    );

  let popupTop = vertical === "above"
    ? triggerTop - SELECTION_POPUP_HEIGHT - SELECTION_UI_GAP
    : triggerTop + SELECTION_TRIGGER_HEIGHT + SELECTION_UI_GAP;

  if (vertical === "above" && popupTop < SELECTION_UI_VIEWPORT_GAP) {
    popupTop = rect.bottom + SELECTION_UI_GAP;
  } else if (
    vertical === "below" &&
    popupTop + SELECTION_POPUP_HEIGHT > window.innerHeight - SELECTION_UI_VIEWPORT_GAP
  ) {
    popupTop = rect.top - SELECTION_POPUP_HEIGHT - SELECTION_UI_GAP;
  }

  popupTop = clamp(
    popupTop,
    SELECTION_UI_VIEWPORT_GAP,
    window.innerHeight - SELECTION_POPUP_HEIGHT - SELECTION_UI_VIEWPORT_GAP
  );

  const popupLeft = horizontal === "left"
    ? clamp(
      rect.left,
      SELECTION_UI_VIEWPORT_GAP,
      window.innerWidth - SELECTION_POPUP_WIDTH - SELECTION_UI_VIEWPORT_GAP
    )
    : clamp(
      rect.right - SELECTION_POPUP_WIDTH,
      SELECTION_UI_VIEWPORT_GAP,
      window.innerWidth - SELECTION_POPUP_WIDTH - SELECTION_UI_VIEWPORT_GAP
    );

  return {
    triggerTop: Math.round(triggerTop),
    triggerLeft: Math.round(triggerLeft),
    popupTop: Math.round(popupTop),
    popupLeft: Math.round(popupLeft)
  };
}

function getSelectionUiOverlapScore(position, blockerRects, selectionRect) {
  if (!position) {
    return 0;
  }

  const triggerRect = expandRect(
    {
      left: position.triggerLeft,
      top: position.triggerTop,
      right: position.triggerLeft + SELECTION_TRIGGER_WIDTH,
      bottom: position.triggerTop + SELECTION_TRIGGER_HEIGHT
    },
    SELECTION_UI_BLOCKER_SAFE_GAP
  );
  const popupRect = expandRect(
    {
      left: position.popupLeft,
      top: position.popupTop,
      right: position.popupLeft + SELECTION_POPUP_WIDTH,
      bottom: position.popupTop + SELECTION_POPUP_HEIGHT
    },
    SELECTION_UI_BLOCKER_SAFE_GAP
  );
  const normalizedSelectionRect = selectionRect
    ? expandRect(
      {
        left: selectionRect.left,
        top: selectionRect.top,
        right: selectionRect.right,
        bottom: selectionRect.bottom
      },
      2
    )
    : null;

  let score = blockerRects.reduce(function (scoreValue, blockerRect) {
    return scoreValue +
      getRectOverlapArea(triggerRect, blockerRect) * 2 +
      getRectOverlapArea(popupRect, blockerRect);
  }, 0);

  if (normalizedSelectionRect) {
    score += getRectOverlapArea(triggerRect, normalizedSelectionRect) * 10;
    score += getRectOverlapArea(popupRect, normalizedSelectionRect) * 16;
  }

  return score;
}

export function computeSelectionUiPosition(rect) {
  if (!rect) {
    return null;
  }

  const verticalOrder = rect.top - SELECTION_TRIGGER_HEIGHT - SELECTION_UI_GAP >= SELECTION_UI_VIEWPORT_GAP
    ? ["above", "below"]
    : ["below", "above"];
  const horizontalOrder = rect.isBackward ? ["left", "right"] : ["right", "left"];
  const blockerRects = getSelectionUiBlockerRects(rect);
  let bestCandidate = null;
  let bestScore = Number.POSITIVE_INFINITY;

  verticalOrder.forEach(function (vertical) {
    horizontalOrder.forEach(function (horizontal) {
      const candidate = buildSelectionUiCandidatePosition(rect, vertical, horizontal);
      if (!candidate) {
        return;
      }

      const score = getSelectionUiOverlapScore(candidate, blockerRects, rect);
      if (score < bestScore) {
        bestScore = score;
        bestCandidate = candidate;
      }
    });
  });

  return bestCandidate;
}

// ============================================================
// Selection UI 정보 수집
// ============================================================

function getSelectionUiInfo() {
  if (!state.railEnabled) {
    return null;
  }

  const selection = window.getSelection();
  if (!selection || selection.isCollapsed || selection.rangeCount < 1) {
    return null;
  }

  if (isSelectionInsideEditableTextSurface(selection)) {
    return null;
  }

  const selectionText = normalizeText(selection.toString());
  if (!selectionText) {
    return null;
  }

  const selectionElement = getSelectionElement(selection);
  if (!selectionElement || (state.root && state.root.contains(selectionElement))) {
    return null;
  }

  const rect = getSelectionClientRect(selection);
  if (!rect) {
    return null;
  }

  const anchor = captureAnchor();
  if (!anchor || !anchor.selectionText) {
    return null;
  }

  return {
    anchor: anchor,
    rect: rect
  };
}

// ============================================================
// 트리거 표시 / 숨김
// ============================================================

export function showSelectionTrigger(anchor, position) {
  if (!state.selectionTrigger) {
    return;
  }

  state.selectionAnchor = anchor;
  state.selectionAnchorCachedAt = Date.now();
  state.selectionPopupPosition = {
    top: position.popupTop,
    left: position.popupLeft
  };

  state.selectionTrigger.hidden = false;
  state.selectionTrigger.style.top = position.triggerTop + "px";
  state.selectionTrigger.style.left = position.triggerLeft + "px";
}

export function hideSelectionTrigger() {
  window.cancelAnimationFrame(state.selectionUiFrame);
  state.selectionUiFrame = 0;

  if (state.selectionTrigger) {
    state.selectionTrigger.hidden = true;
  }

  state.selectionAnchor = null;
  state.selectionPopupPosition = null;
}

// ============================================================
// Selection UI 업데이트 스케줄
// ============================================================

function updateSelectionTrigger() {
  if (!state.railEnabled || state.popup) {
    hideSelectionTrigger();
    return;
  }

  const selectionInfo = getSelectionUiInfo();
  if (!selectionInfo) {
    hideSelectionTrigger();
    return;
  }

  const position = computeSelectionUiPosition(selectionInfo.rect);
  if (!position) {
    hideSelectionTrigger();
    return;
  }

  showSelectionTrigger(selectionInfo.anchor, position);
}

export function scheduleSelectionUiUpdate() {
  window.cancelAnimationFrame(state.selectionUiFrame);
  state.selectionUiFrame = window.requestAnimationFrame(function () {
    state.selectionUiFrame = 0;
    updateSelectionTrigger();
  });
}

// ============================================================
// 북마크 저장 흐름
// ============================================================

function shouldPreferClaudeSandboxCardAnchor(primaryAnchor, sandboxCardAnchor) {
  if (!sandboxCardAnchor) {
    return false;
  }
  if (!primaryAnchor) {
    return true;
  }
  if (isFrameRelayAnchor(primaryAnchor) || isSandboxCardAnchor(primaryAnchor)) {
    return false;
  }

  return !normalizeText(primaryAnchor.selectionText || primaryAnchor.selectionDisplayText || "");
}

function captureBestAvailableAnchor(options) {
  const nextOptions = options || {};
  if (nextOptions.fallbackAnchor) {
    return nextOptions.fallbackAnchor;
  }

  const primaryAnchor = captureAnchor();
  const sandboxCardAnchor = captureClaudeSandboxCardAnchor();

  if (shouldPreferClaudeSandboxCardAnchor(primaryAnchor, sandboxCardAnchor)) {
    return sandboxCardAnchor;
  }

  return primaryAnchor || sandboxCardAnchor || null;
}

export function startBookmarkFlow(options) {
  if (!state.railEnabled) {
    hideSelectionTrigger();
    return;
  }

  const nextOptions = options || {};
  const anchor = captureBestAvailableAnchor(nextOptions);
  if (!anchor) {
    hideSelectionTrigger();
    return;
  }

  hideSelectionTrigger();
  if (_openSavePopup) _openSavePopup(anchor, nextOptions.popupPosition || null);
}

export function handleSelectionTriggerClick(event) {
  if (event) {
    event.preventDefault();
  }
  if (!state.railEnabled) {
    hideSelectionTrigger();
    return;
  }

  const popupPosition = state.selectionPopupPosition;
  // Attempt fresh capture; fall back to cached if selection already collapsed
  const freshAnchor = captureAnchor();
  // Staleness guard: discard cached anchor if older than 5 seconds
  const STALE_THRESHOLD_MS = 5000;
  const cachedAnchor = (
    state.selectionAnchor &&
    state.selectionAnchorCachedAt &&
    (Date.now() - state.selectionAnchorCachedAt) < STALE_THRESHOLD_MS
  ) ? state.selectionAnchor : null;
  startBookmarkFlow({
    popupPosition: popupPosition,
    fallbackAnchor: freshAnchor || cachedAnchor
  });
}
