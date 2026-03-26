// ============================================================
// frame-relay/bridge.js — iframe 간 통신 (selection relay)
// ============================================================
// 비유: "건물 내선 전화 교환기". 부모 페이지와 iframe 사이에서
//       텍스트 선택 정보를 주고받는 중계 시스템입니다.
//
// 순환 의존 방지: UI 함수(showSelectionTrigger, hideSelectionTrigger,
// computeSelectionUiPosition, isSelectionInsideEditableTextSurface,
// getSelectionClientRect)는 콜백으로 주입받습니다.
// content.js 엔트리에서 setFrameRelayUiCallbacks()로 연결하세요.

import state from './state.js';
import {
  FRAME_RELAY_SELECTION_MESSAGE_TYPE,
  FRAME_RELAY_CLEAR_MESSAGE_TYPE,
  FRAME_RELAY_REVEAL_MESSAGE_TYPE,
  FRAME_RELAY_DEBUG_MESSAGE_TYPE,
  FRAME_RELAY_DEBUG_QUERY_PARAM,
  FRAME_RELAY_DEBUG_STORAGE_KEY,
  MAX_CAPTURED_SELECTION_LENGTH
} from './constants.js';
import { safePostMessageToTarget, logWarn } from './log.js';
import { normalizeText, truncateText, fingerprintText, clamp } from './text.js';

// ---- UI callback slots (injected from content.js) ----

let _showSelectionTrigger = null;
let _hideSelectionTrigger = null;
let _computeSelectionUiPosition = null;
let _isSelectionInsideEditableTextSurface = null;
let _getSelectionClientRect = null;

export function setFrameRelayUiCallbacks(callbacks) {
  _showSelectionTrigger = callbacks.showSelectionTrigger || null;
  _hideSelectionTrigger = callbacks.hideSelectionTrigger || null;
  _computeSelectionUiPosition = callbacks.computeSelectionUiPosition || null;
  _isSelectionInsideEditableTextSurface = callbacks.isSelectionInsideEditableTextSurface || null;
  _getSelectionClientRect = callbacks.getSelectionClientRect || null;
}

// ---- Internal helpers ----

export function normalizeFrameRelayUrl(value) {
  if (!value) {
    return "";
  }

  try {
    const url = new URL(String(value), window.location.href);
    url.hash = "";
    return url.toString();
  } catch (error) {
    return String(value || "");
  }
}

function isFrameRelayDebugRequested() {
  try {
    const params = new URLSearchParams(window.location.search || "");
    const queryValue = params.get(FRAME_RELAY_DEBUG_QUERY_PARAM);
    if (queryValue === "1" || queryValue === "true" || queryValue === "yes") {
      return true;
    }
  } catch (error) { logWarn("unexpected error", error); }

  try {
    const referrerUrl = document.referrer ? new URL(document.referrer) : null;
    const referrerValue = referrerUrl
      ? referrerUrl.searchParams.get(FRAME_RELAY_DEBUG_QUERY_PARAM)
      : "";
    if (referrerValue === "1" || referrerValue === "true" || referrerValue === "yes") {
      return true;
    }
  } catch (error) { logWarn("unexpected error", error); }

  try {
    const storageValue = window.localStorage
      ? window.localStorage.getItem(FRAME_RELAY_DEBUG_STORAGE_KEY)
      : "";
    if (storageValue === "1" || storageValue === "true" || storageValue === "yes") {
      return true;
    }
  } catch (error) {
    return false;
  }

  return false;
}

function isFrameRelayDebugEnabled() {
  return Boolean(state.frameRelayDebugEnabled || isFrameRelayDebugRequested());
}

export function debugFrameRelay(label, details) {
  if (
    !isFrameRelayDebugEnabled() ||
    !window.console ||
    typeof window.console.log !== "function"
  ) {
    return;
  }

  try {
    window.console.log("[ChatMARKup][frame-relay]", label, Object.assign({
      host: window.location.hostname || "",
      isTopFrame: window.self === window.top
    }, details || {}));
  } catch (error) { logWarn("unexpected error", error); }
}

function logFrameRelayInventory(reason) {
  if (!isFrameRelayDebugEnabled() || window.self !== window.top || !document || !document.querySelectorAll) {
    return;
  }

  const frames = Array.from(document.querySelectorAll("iframe")).map(function (frame, index) {
    return {
      index: index,
      src: normalizeFrameRelayUrl(frame.getAttribute("src") || frame.src || ""),
      name: String(frame.name || ""),
      sandbox: frame.getAttribute("sandbox") || ""
    };
  });

  debugFrameRelay("top-frame-inventory", {
    reason: reason || "",
    frameCount: frames.length,
    frames: frames
  });
}

function summarizeFrameRelayRect(rect) {
  if (!rect) {
    return null;
  }

  return {
    top: Math.round(Number(rect.top || 0)),
    left: Math.round(Number(rect.left || 0)),
    width: Math.round(Number(rect.width || 0)),
    height: Math.round(Number(rect.height || 0))
  };
}

function summarizeFrameRelayPosition(position) {
  if (!position) {
    return null;
  }

  return {
    left: Math.round(Number(position.left || 0)),
    top: Math.round(Number(position.top || 0))
  };
}

function isKnownFrameRelayMessageType(type) {
  return (
    type === FRAME_RELAY_SELECTION_MESSAGE_TYPE ||
    type === FRAME_RELAY_CLEAR_MESSAGE_TYPE ||
    type === FRAME_RELAY_REVEAL_MESSAGE_TYPE ||
    type === FRAME_RELAY_DEBUG_MESSAGE_TYPE
  );
}

function isDirectParentFrameSource(source) {
  if (!source || window.self === window.top) {
    return false;
  }

  try {
    return source === window.parent;
  } catch (error) {
    return false;
  }
}

function isAcceptedFrameRelayMessageSource(event, payload) {
  if (!event || !payload || typeof payload !== "object") {
    return false;
  }

  if (
    payload.type === FRAME_RELAY_SELECTION_MESSAGE_TYPE ||
    payload.type === FRAME_RELAY_CLEAR_MESSAGE_TYPE
  ) {
    return Boolean(findChildFrameElementBySource(event.source));
  }

  if (
    payload.type === FRAME_RELAY_REVEAL_MESSAGE_TYPE ||
    payload.type === FRAME_RELAY_DEBUG_MESSAGE_TYPE
  ) {
    return isDirectParentFrameSource(event.source);
  }

  return false;
}

function findChildFrameElementBySource(source) {
  if (!source || !document || !document.querySelectorAll) {
    return null;
  }

  const frames = Array.from(document.querySelectorAll("iframe"));
  for (let index = 0; index < frames.length; index += 1) {
    const frame = frames[index];
    try {
      if (frame && frame.contentWindow === source) {
        return frame;
      }
    } catch (error) { logWarn("unexpected error", error); }
  }

  debugFrameRelay("frame-source-unmatched", {
    frameCount: frames.length
  });
  return null;
}

function postFrameRelayMessageToParent(payload) {
  if (!payload || window.parent === window) {
    return;
  }

  debugFrameRelay("relay-to-parent", {
    type: payload.type || "",
    frameRelayKey: payload.frameRelayKey || "",
    textLength: payload.text ? payload.text.length : 0
  });
  safePostMessageToTarget(window.parent, payload);
}

function postFrameRelayClearMessage() {
  postFrameRelayMessageToParent({
    type: FRAME_RELAY_CLEAR_MESSAGE_TYPE,
    frameRelayKey: getCurrentFrameRelayKey(),
    frameRelayOrigin: window.location.origin || "",
    frameRelayHref: normalizeFrameRelayUrl(window.location.href),
    frameRelayName: String(window.name || "")
  });
}

function translateFrameRelayRect(rect, frameElement) {
  if (!rect || !frameElement || !frameElement.getBoundingClientRect) {
    return null;
  }

  const frameRect = frameElement.getBoundingClientRect();
  return {
    top: frameRect.top + Number(rect.top || 0),
    right: frameRect.left + Number(rect.right || 0),
    bottom: frameRect.top + Number(rect.bottom || 0),
    left: frameRect.left + Number(rect.left || 0),
    width: Number(rect.width || 0),
    height: Number(rect.height || 0),
    isBackward: Boolean(rect.isBackward)
  };
}

function translateIncomingFrameRelaySelection(event, payload) {
  const childFrame = findChildFrameElementBySource(event ? event.source : null);
  if (!childFrame || !payload || !payload.rect) {
    debugFrameRelay("selection-translation-failed", {
      hasChildFrame: Boolean(childFrame),
      hasRect: Boolean(payload && payload.rect),
      frameRelayKey: payload && payload.frameRelayKey || ""
    });
    return null;
  }

  const translatedRect = translateFrameRelayRect(payload.rect, childFrame);
  if (!translatedRect) {
    debugFrameRelay("selection-translation-failed", {
      hasChildFrame: true,
      hasRect: true,
      reason: "translated-rect-missing",
      frameRelayKey: payload && payload.frameRelayKey || ""
    });
    return null;
  }

  return Object.assign({}, payload, {
    rect: translatedRect
  });
}

function shouldHideFrameRelaySelection(payload) {
  const anchor = state.selectionAnchor;
  if (!isFrameRelayAnchor(anchor)) {
    return false;
  }

  if (payload.frameRelayKey && anchor.frameRelayKey) {
    return payload.frameRelayKey === anchor.frameRelayKey;
  }
  if (payload.frameRelayHref && anchor.frameRelayHref) {
    return payload.frameRelayHref === anchor.frameRelayHref;
  }
  if (payload.frameRelayOrigin && anchor.frameRelayOrigin) {
    return payload.frameRelayOrigin === anchor.frameRelayOrigin;
  }

  return true;
}

function handleFrameRelaySelectionChange() {
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed || selection.rangeCount < 1) {
    debugFrameRelay("selection-cleared", {
      reason: "collapsed-or-empty-range"
    });
    postFrameRelayClearMessage();
    return;
  }

  if (_isSelectionInsideEditableTextSurface && _isSelectionInsideEditableTextSurface(selection)) {
    debugFrameRelay("selection-cleared", {
      reason: "editable-selection"
    });
    postFrameRelayClearMessage();
    return;
  }

  const selectionText = normalizeText(selection.toString());
  if (!selectionText) {
    debugFrameRelay("selection-cleared", {
      reason: "normalized-text-empty"
    });
    postFrameRelayClearMessage();
    return;
  }

  const rect = _getSelectionClientRect ? _getSelectionClientRect(selection) : null;
  if (!rect) {
    debugFrameRelay("selection-cleared", {
      reason: "selection-rect-missing",
      textLength: selectionText.length
    });
    postFrameRelayClearMessage();
    return;
  }

  debugFrameRelay("selection-captured", {
    textLength: selectionText.length,
    rect: summarizeFrameRelayRect(rect),
    frameRelayKey: getCurrentFrameRelayKey()
  });
  postFrameRelayMessageToParent({
    type: FRAME_RELAY_SELECTION_MESSAGE_TYPE,
    text: selectionText,
    rect: rect,
    frameRelayKey: getCurrentFrameRelayKey(),
    frameRelayOrigin: window.location.origin || "",
    frameRelayHref: normalizeFrameRelayUrl(window.location.href),
    frameRelayName: String(window.name || "")
  });
}

function handleIncomingFrameRelaySelection(event, payload) {
  const translated = translateIncomingFrameRelaySelection(event, payload);
  if (!translated) {
    debugFrameRelay("selection-translation-skipped", {
      reason: "frame-not-resolved",
      frameRelayKey: payload && payload.frameRelayKey || ""
    });
    return;
  }

  if (window.self !== window.top) {
    debugFrameRelay("relay-bubbling-up", {
      type: translated.type || "",
      frameRelayKey: translated.frameRelayKey || ""
    });
    postFrameRelayMessageToParent(translated);
    return;
  }

  if (!state.railEnabled || state.popup) {
    debugFrameRelay("selection-trigger-skipped", {
      reason: !state.railEnabled ? "rail-disabled" : "popup-open",
      frameRelayKey: translated.frameRelayKey || ""
    });
    return;
  }

  const position = _computeSelectionUiPosition ? _computeSelectionUiPosition(translated.rect) : null;
  if (!position) {
    debugFrameRelay("selection-trigger-skipped", {
      reason: "selection-position-missing",
      rect: summarizeFrameRelayRect(translated.rect),
      frameRelayKey: translated.frameRelayKey || ""
    });
    if (_hideSelectionTrigger) _hideSelectionTrigger();
    return;
  }

  debugFrameRelay("selection-trigger-ready", {
    frameRelayKey: translated.frameRelayKey || "",
    rect: summarizeFrameRelayRect(translated.rect),
    position: summarizeFrameRelayPosition(position),
    textLength: translated.text ? translated.text.length : 0
  });
  if (_showSelectionTrigger) _showSelectionTrigger(buildFrameRelayAnchor(translated), position);
}

function handleIncomingFrameRelayClear(event, payload) {
  if (!findChildFrameElementBySource(event.source)) {
    debugFrameRelay("selection-clear-skipped", {
      reason: "frame-source-not-found",
      frameRelayKey: payload && payload.frameRelayKey || ""
    });
    return;
  }

  if (window.self !== window.top) {
    postFrameRelayMessageToParent(payload);
    return;
  }

  if (shouldHideFrameRelaySelection(payload)) {
    if (_hideSelectionTrigger) _hideSelectionTrigger();
  }
}

function handleIncomingFrameRelayReveal(payload) {
  if (window.self === window.top) {
    return;
  }

  if (doesFrameRelayPayloadMatchCurrentFrame(payload)) {
    debugFrameRelay("reveal-matched-current-frame", {
      frameRelayKey: payload && payload.frameRelayKey || "",
      scrollRatio: payload && payload.scrollRatio
    });
    revealCurrentFrameBookmark(payload);
    return;
  }

  debugFrameRelay("reveal-forwarding-to-children", {
    frameRelayKey: payload && payload.frameRelayKey || ""
  });
  broadcastFrameRelayMessageToChildFrames(payload);
}

function handleIncomingFrameRelayDebugState(payload) {
  const enabled = Boolean(payload && payload.enabled);
  state.frameRelayDebugEnabled = enabled;

  debugFrameRelay("debug-state-updated", {
    enabled: enabled,
    source: payload && payload.source || ""
  });

  if (window.self !== window.top) {
    broadcastFrameRelayMessageToChildFrames({
      type: FRAME_RELAY_DEBUG_MESSAGE_TYPE,
      enabled: enabled,
      source: payload && payload.source || "parent-frame"
    });
  }
}

export function handleFrameRelayMessage(event) {
  if (!event || !event.data || typeof event.data !== "object") {
    return;
  }

  const payload = event.data;
  if (!isKnownFrameRelayMessageType(payload.type)) {
    return;
  }

  const acceptedSource = isAcceptedFrameRelayMessageSource(event, payload);
  debugFrameRelay(acceptedSource ? "relay-message-received" : "relay-message-skipped", {
    type: payload.type,
    sourceMatched: acceptedSource,
    frameRelayKey: payload.frameRelayKey || "",
    origin: event.origin || "",
    textLength: payload.text ? payload.text.length : 0,
    reason: acceptedSource ? "" : "unexpected-source"
  });

  if (!acceptedSource) {
    return;
  }

  if (payload.type === FRAME_RELAY_SELECTION_MESSAGE_TYPE) {
    handleIncomingFrameRelaySelection(event, payload);
    return;
  }
  if (payload.type === FRAME_RELAY_CLEAR_MESSAGE_TYPE) {
    handleIncomingFrameRelayClear(event, payload);
    return;
  }
  if (payload.type === FRAME_RELAY_REVEAL_MESSAGE_TYPE) {
    handleIncomingFrameRelayReveal(payload);
    return;
  }
  if (payload.type === FRAME_RELAY_DEBUG_MESSAGE_TYPE) {
    handleIncomingFrameRelayDebugState(payload);
  }
}

function revealCurrentFrameBookmark(payload) {
  const ratio = typeof payload.scrollRatio === "number" ? clamp(payload.scrollRatio, 0, 1) : 0.5;
  const scrollMax = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);

  debugFrameRelay("reveal-scrolling-current-frame", {
    frameRelayKey: payload && payload.frameRelayKey || "",
    ratio: ratio,
    scrollMax: scrollMax
  });
  window.scrollTo({
    top: Math.round(scrollMax * ratio),
    behavior: "smooth"
  });
}

// ---- Exported functions ----

export function bindFrameRelayBridge() {
  state.frameRelayDebugEnabled = isFrameRelayDebugRequested();
  document.addEventListener("selectionchange", handleFrameRelaySelectionChange);
  document.addEventListener("mouseup", handleFrameRelaySelectionChange, true);
  window.addEventListener("message", handleFrameRelayMessage);
  debugFrameRelay("frame-bridge-bound", {
    href: normalizeFrameRelayUrl(window.location.href),
    referrer: normalizeFrameRelayUrl(document.referrer),
    frameRelayKey: getCurrentFrameRelayKey()
  });
}

export function isFrameRelayAnchor(anchor) {
  return Boolean(
    anchor &&
    (
      anchor.frameRelay ||
      anchor.frameRelayKey ||
      anchor.frameRelayHref ||
      anchor.frameRelayOrigin
    )
  );
}

export function getCurrentFrameRelayKey() {
  return buildFrameRelayKey(window.location.href, document.referrer, window.name);
}

export function buildFrameRelayKey(href, referrer, frameName) {
  return [
    normalizeFrameRelayUrl(href),
    normalizeFrameRelayUrl(referrer),
    String(frameName || "")
  ].join("|");
}

export function doesFrameRelayPayloadMatchCurrentFrame(payload) {
  if (!payload || typeof payload !== "object") {
    return false;
  }

  const currentKey = getCurrentFrameRelayKey();
  if (payload.frameRelayKey && currentKey) {
    return payload.frameRelayKey === currentKey;
  }

  const currentHref = normalizeFrameRelayUrl(window.location.href);
  if (payload.frameRelayHref && currentHref) {
    return payload.frameRelayHref === currentHref;
  }

  return Boolean(payload.frameRelayOrigin && payload.frameRelayOrigin === (window.location.origin || ""));
}

export function requestFrameBookmarkReveal(anchor) {
  if (!isFrameRelayAnchor(anchor)) {
    return false;
  }

  const dispatched = broadcastFrameRelayMessageToChildFrames({
    type: FRAME_RELAY_REVEAL_MESSAGE_TYPE,
    frameRelayKey: anchor.frameRelayKey || "",
    frameRelayOrigin: anchor.frameRelayOrigin || "",
    frameRelayHref: anchor.frameRelayHref || "",
    frameRelayName: anchor.frameRelayName || "",
    scrollRatio: Number.isFinite(anchor.scrollRatio) ? anchor.scrollRatio : 0.5,
    selectionText: truncateText(anchor.selectionText || "", MAX_CAPTURED_SELECTION_LENGTH)
  });

  debugFrameRelay("reveal-request-dispatched", {
    frameRelayKey: anchor.frameRelayKey || "",
    dispatched: dispatched,
    selectionLength: anchor.selectionText ? anchor.selectionText.length : 0
  });
  return dispatched > 0;
}

export function broadcastFrameRelayMessageToChildFrames(payload) {
  const frames = Array.from(document.querySelectorAll("iframe"));
  let dispatched = 0;

  frames.forEach(function (frame) {
    if (!frame) {
      return;
    }

    try {
      if (frame.contentWindow) {
        safePostMessageToTarget(frame.contentWindow, payload);
        dispatched += 1;
      }
    } catch (error) {
      logWarn("broadcast postMessage failed", error);
    }
  });

  debugFrameRelay("broadcast-to-children", {
    type: payload && payload.type || "",
    frameCount: frames.length,
    dispatched: dispatched,
    frameRelayKey: payload && payload.frameRelayKey || ""
  });
  return dispatched;
}

export function buildFrameRelayAnchor(payload) {
  const normalizedText = normalizeText(payload && payload.text || "");
  const scrollHeight = Math.max(1, document.documentElement.scrollHeight - window.innerHeight);
  const absoluteTop = Number(payload && payload.rect ? payload.rect.top : 0) + window.scrollY;
  const scrollRatio = clamp(absoluteTop / scrollHeight, 0, 1);

  return {
    anchorId: "",
    blockTag: "iframe",
    blockFingerprint: fingerprintText(normalizedText),
    messageFingerprint: "",
    messageRole: "",
    blockIndex: -1,
    blockIndexInMessage: -1,
    messageIndex: -1,
    scrollRatio: scrollRatio,
    selectionText: truncateText(normalizedText, MAX_CAPTURED_SELECTION_LENGTH),
    selectionDisplayText: "",
    selectionTextRaw: "",
    blockTextSnippet: truncateText(normalizedText, 220),
    selectionStart: -1,
    selectionLength: normalizedText.length,
    selectionStartRatio: -1,
    selectionPrefix: "",
    selectionSuffix: "",
    selectionContextFingerprint: "",
    selectionExactStart: -1,
    selectionExactEnd: -1,
    selectionRawPrefix: "",
    selectionRawSuffix: "",
    selectionCodeOffsetStart: -1,
    selectionCodeOffsetEnd: -1,
    selectionCodeLine: -1,
    selectionCodeColumn: -1,
    selectionCodeContextFingerprint: "",
    selectionSpanStartFingerprint: "",
    selectionSpanEndFingerprint: "",
    selectionSpanBlockCount: -1,
    selectionSpanHead: "",
    selectionSpanMiddle: "",
    selectionSpanTail: "",
    selectionSpanMarkerSignature: "",
    frameRelay: true,
    frameRelayKey: payload && payload.frameRelayKey || "",
    frameRelayOrigin: payload && payload.frameRelayOrigin || "",
    frameRelayHref: payload && payload.frameRelayHref || "",
    frameRelayName: payload && payload.frameRelayName || ""
  };
}

export function syncFrameRelayDebugState() {
  const enabled = isFrameRelayDebugRequested();
  state.frameRelayDebugEnabled = enabled;

  if (!enabled || window.self !== window.top) {
    return;
  }

  logFrameRelayInventory("top-bind");

  [0, 250, 1000, 2500].forEach(function (delay) {
    window.setTimeout(function () {
      broadcastFrameRelayMessageToChildFrames({
        type: FRAME_RELAY_DEBUG_MESSAGE_TYPE,
        enabled: true,
        source: "top-frame"
      });
    }, delay);
  });
}
