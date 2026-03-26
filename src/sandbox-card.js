// ============================================================
// frame-relay/sandbox-card.js — Claude Artifact 카드 전용 로직
// ============================================================
// 비유: "Claude 전용 액자 관리". Claude의 sandbox iframe(artifact)을
//       감지하고, 해당 카드 전체를 북마크 타겟으로 다루는 로직입니다.
//
// 순환 의존 방지: UI 함수(hideSelectionTrigger, startBookmarkFlow,
// preventFocusSteal)는 콜백으로 주입받습니다.
// content.js 엔트리에서 setSandboxCardUiCallbacks()로 연결하세요.

import state from './state.js';
import {
  ROOT_ID,
  SANDBOX_CARD_TRIGGER_WIDTH,
  SANDBOX_CARD_TRIGGER_HEIGHT,
  SANDBOX_CARD_TRIGGER_HOVER_BRIDGE,
  SANDBOX_CARD_HIGHLIGHT_FADE_IN_DURATION,
  SANDBOX_CARD_HIGHLIGHT_HOLD_DURATION,
  SANDBOX_CARD_HIGHLIGHT_FADE_OUT_DURATION,
  SANDBOX_CARD_HIGHLIGHT_EXIT_FADE_OUT_DURATION
} from './constants.js';
import { normalizeText, truncateText, fingerprintText, fingerprintRawText, truncateRawText, clamp } from './text.js';
import { getScopeRoot, getCurrentSiteProfile, getElementText, getElementScrollRatio } from './dom.js';
import { normalizeFrameRelayUrl } from './bridge.js';

// ---- UI callback slots (injected from content.js) ----

let _hideSelectionTrigger = null;
let _startBookmarkFlow = null;
let _preventFocusSteal = null;

export function setSandboxCardUiCallbacks(callbacks) {
  _hideSelectionTrigger = callbacks.hideSelectionTrigger || null;
  _startBookmarkFlow = callbacks.startBookmarkFlow || null;
  _preventFocusSteal = callbacks.preventFocusSteal || null;
}

// ---- Internal helpers ----

function isUsableClaudeSandboxFrame(frame) {
  if (!frame || !frame.getBoundingClientRect || !frame.closest || frame.closest("#" + ROOT_ID)) {
    return false;
  }

  const rect = frame.getBoundingClientRect();
  if (rect.width < 180 || rect.height < 120) {
    return false;
  }
  const style = window.getComputedStyle(frame);
  return style.display !== "none" && style.visibility !== "hidden";
}

function resolveClaudeSandboxCardContainer(frame) {
  if (!frame) {
    return null;
  }

  const scopeRoot = getScopeRoot();
  const frameRect = frame.getBoundingClientRect();
  const frameArea = Math.max(1, frameRect.width * frameRect.height);
  let candidate = frame;
  let current = frame.parentElement;

  while (current && current !== scopeRoot && current !== document.body) {
    if (!current.getBoundingClientRect) {
      break;
    }

    const rect = current.getBoundingClientRect();
    if (!rect.width || !rect.height) {
      current = current.parentElement;
      continue;
    }

    if (current.querySelectorAll("iframe[sandbox]").length !== 1) {
      break;
    }

    const areaRatio = (rect.width * rect.height) / frameArea;
    if (areaRatio > 6) {
      break;
    }

    candidate = current;
    current = current.parentElement;
  }

  return candidate;
}

function buildElementDomPathFingerprint(element) {
  if (!(element instanceof Element)) {
    return "";
  }

  const scopeRoot = getScopeRoot();
  const segments = [];
  let current = element;
  let depth = 0;

  while (current && current !== scopeRoot && current !== document.body && depth < 6) {
    segments.push(buildElementIdentitySegment(current));
    current = current.parentElement;
    depth += 1;
  }

  if (current === scopeRoot) {
    segments.push("scope");
  } else if (current === document.body) {
    segments.push("body");
  }

  return fingerprintText(segments.reverse().join(">"));
}

function buildElementIdentitySegment(element) {
  if (!(element instanceof Element)) {
    return "";
  }

  const tag = element.tagName ? element.tagName.toLowerCase() : "node";
  const id = truncateRawText(element.id || "", 48);
  const dataTestId = element.getAttribute ? truncateRawText(element.getAttribute("data-testid") || "", 48) : "";
  const role = element.getAttribute ? truncateRawText(element.getAttribute("role") || "", 24) : "";
  const siblingIndex = getElementSiblingIndex(element);
  const sameTagIndex = getElementSiblingIndex(element, function (sibling) {
    return Boolean(sibling && sibling.tagName === element.tagName);
  });

  return [
    tag,
    id ? "#" + id : "",
    dataTestId ? "[t=" + dataTestId + "]" : "",
    role ? "[r=" + role + "]" : "",
    "{n=" + siblingIndex + ",t=" + sameTagIndex + "}"
  ].join("");
}

function buildElementIdentityLabel(element) {
  if (!(element instanceof Element)) {
    return "";
  }

  return [
    element.tagName ? element.tagName.toLowerCase() : "",
    truncateRawText(element.id || "", 48),
    truncateRawText(element.getAttribute ? element.getAttribute("data-testid") || "" : "", 64),
    truncateRawText(element.getAttribute ? element.getAttribute("role") || "" : "", 24),
    truncateText(element.getAttribute ? element.getAttribute("aria-label") || "" : "", 64),
    truncateText(element.getAttribute ? element.getAttribute("title") || "" : "", 64)
  ].join("|");
}

function getElementSiblingIndex(element, predicate) {
  if (!(element instanceof Element) || !element.parentElement) {
    return -1;
  }

  const siblings = Array.from(element.parentElement.children);
  let matchedIndex = 0;
  for (let index = 0; index < siblings.length; index += 1) {
    const sibling = siblings[index];
    if (!(sibling instanceof Element)) {
      continue;
    }
    if (predicate && !predicate(sibling)) {
      continue;
    }
    if (sibling === element) {
      return matchedIndex;
    }
    matchedIndex += 1;
  }

  return -1;
}

function buildSandboxCardPositionFingerprint(rect) {
  if (!rect) {
    return "";
  }

  const absoluteTop = Math.round((window.scrollY + rect.top) / 80);
  const absoluteLeft = Math.round((window.scrollX + rect.left) / 48);
  const widthBucket = Math.round(rect.width / 40);
  const heightBucket = Math.round(rect.height / 40);

  return fingerprintText([
    absoluteTop,
    absoluteLeft,
    widthBucket,
    heightBucket
  ].join("|"));
}

function buildClaudeSandboxCardText(container, frame) {
  const directLabel = [
    frame && frame.getAttribute ? frame.getAttribute("title") : "",
    frame && frame.title ? frame.title : "",
    frame && frame.getAttribute ? frame.getAttribute("aria-label") : "",
    frame && frame.name ? frame.name : "",
    container && container.getAttribute ? container.getAttribute("aria-label") : "",
    container && container.getAttribute ? container.getAttribute("title") : ""
  ].map(normalizeText).find(isPlausibleSandboxCardLabel);
  if (directLabel) {
    return truncateText(directLabel, 96);
  }

  const headingLabel = findSandboxCardHeadingText(container, frame);
  if (headingLabel) {
    return truncateText(headingLabel, 96);
  }

  const siblingLabel = findSandboxCardSiblingText(container, frame);
  if (siblingLabel) {
    return truncateText(siblingLabel, 96);
  }

  return "Claude widget";
}

function isPlausibleSandboxCardLabel(value) {
  const text = normalizeText(value);
  if (!text || text.length < 3 || text.length > 96) {
    return false;
  }

  if (!/[A-Za-z0-9\u00C0-\u024F\u1100-\u11FF\u3130-\u318F\uAC00-\uD7AF]/.test(text)) {
    return false;
  }

  return !/^(copy|copied|share|edit|delete|save|close|retry|run|open|mcp_apps|sandbox|iframe|widget)$/i.test(text);
}

function findSandboxCardHeadingText(container, frame) {
  if (!container || !container.querySelectorAll) {
    return "";
  }

  const selectors = [
    "h1",
    "h2",
    "h3",
    "h4",
    "h5",
    "h6",
    '[role="heading"]',
    "[aria-level]",
    '[data-testid*="title"]',
    '[class*="title"]',
    '[class*="header"]'
  ].join(",");
  let best = "";

  Array.from(container.querySelectorAll(selectors)).forEach(function (node) {
    if (!(node instanceof HTMLElement)) {
      return;
    }
    if (node === frame || node.contains(frame)) {
      return;
    }

    const text = normalizeText(getElementText(node));
    if (!isPlausibleSandboxCardLabel(text)) {
      return;
    }
    if (!best || text.length < best.length) {
      best = text;
    }
  });

  return best;
}

function findSandboxCardSiblingText(container, frame) {
  if (!(container instanceof HTMLElement) || !frame) {
    return "";
  }

  let best = "";
  Array.from(container.children).forEach(function (child) {
    if (!(child instanceof HTMLElement)) {
      return;
    }
    if (child === frame || child.contains(frame)) {
      return;
    }

    const text = normalizeText(getElementText(child));
    if (!isPlausibleSandboxCardLabel(text)) {
      return;
    }
    if (!best || text.length < best.length) {
      best = text;
    }
  });

  return best;
}

function getVisibleRectArea(rect) {
  if (!rect || !Number.isFinite(rect.width) || !Number.isFinite(rect.height)) {
    return 0;
  }

  const visibleWidth = Math.max(0, Math.min(rect.right, window.innerWidth) - Math.max(rect.left, 0));
  const visibleHeight = Math.max(0, Math.min(rect.bottom, window.innerHeight) - Math.max(rect.top, 0));
  return visibleWidth * visibleHeight;
}

function getRecentClaudeSandboxCardCandidate(candidates) {
  if (!Array.isArray(candidates) || !candidates.length) {
    return null;
  }
  if (!state.lastSandboxCardKey || !state.lastSandboxCardInteractedAt) {
    return null;
  }
  if ((Date.now() - state.lastSandboxCardInteractedAt) > 120000) {
    return null;
  }

  return candidates.find(function (candidate) {
    return candidate.key === state.lastSandboxCardKey;
  }) || null;
}

function buildClaudeSandboxCardCandidate(frame, domIndex) {
  if (!isUsableClaudeSandboxFrame(frame)) {
    return null;
  }

  const container = resolveClaudeSandboxCardContainer(frame);
  if (!container || !container.getBoundingClientRect) {
    return null;
  }

  const frameRect = frame.getBoundingClientRect();
  const visibleArea = getVisibleRectArea(frameRect);
  const cardArea = Math.max(1, frameRect.width * frameRect.height);
  const frameHref = normalizeFrameRelayUrl(frame.getAttribute("src") || frame.src || "");
  const frameName = truncateRawText(frame.name || "", 160);
  const frameSandbox = truncateRawText(frame.getAttribute("sandbox") || "", 320);
  const frameFingerprint = fingerprintText([frameHref, frameName, frameSandbox].join("|"));
  const cardText = buildClaudeSandboxCardText(container, frame);
  const framePathFingerprint = buildElementDomPathFingerprint(frame);
  const containerPathFingerprint = buildElementDomPathFingerprint(container);
  const containerFingerprint = fingerprintText([
    containerPathFingerprint,
    buildElementIdentityLabel(container),
    buildElementIdentityLabel(container.parentElement),
    cardText || ""
  ].join("|"));
  const positionFingerprint = buildSandboxCardPositionFingerprint(frameRect);
  const sandboxSiblingIndex = getElementSiblingIndex(frame, function (sibling) {
    return Boolean(sibling && sibling.tagName === "IFRAME" && sibling.hasAttribute("sandbox"));
  });
  const cardFingerprint = fingerprintText([
    frameFingerprint,
    framePathFingerprint,
    containerFingerprint,
    positionFingerprint,
    String(sandboxSiblingIndex),
    cardText || ""
  ].join("|"));

  return {
    frame: frame,
    card: frame,
    cardContainer: container,
    cardRect: frameRect,
    visibleArea: visibleArea,
    visibleRatio: clamp(visibleArea / cardArea, 0, 1),
    cardText: cardText,
    cardFingerprint: cardFingerprint,
    frameFingerprint: frameFingerprint,
    framePathFingerprint: framePathFingerprint,
    containerFingerprint: containerFingerprint,
    containerPathFingerprint: containerPathFingerprint,
    positionFingerprint: positionFingerprint,
    domIndex: Number.isInteger(domIndex) ? domIndex : -1,
    sandboxSiblingIndex: sandboxSiblingIndex,
    anchorId: frame.id || "",
    containerId: container.id || "",
    frameHref: frameHref,
    frameName: frameName,
    frameSandbox: frameSandbox,
    scrollRatio: getElementScrollRatio(frame)
  };
}

// ---- Sandbox card highlight UI (internal to this module) ----

export function getSandboxCardHighlightElement() {
  if (!state.sandboxCardLayer) {
    return null;
  }

  let highlight = state.sandboxCardLayer.querySelector(".cgptbm-sandbox-card-highlight");
  if (!highlight) {
    highlight = document.createElement("div");
    highlight.className = "cgptbm-sandbox-card-highlight";
    state.sandboxCardLayer.appendChild(highlight);
  }

  return highlight;
}

export function updateSandboxCardHighlightRect(rect) {
  const highlight = getSandboxCardHighlightElement();
  if (!highlight || !rect) {
    return;
  }

  highlight.style.top = Math.round(rect.top) + "px";
  highlight.style.left = Math.round(rect.left) + "px";
  highlight.style.width = Math.max(0, Math.round(rect.width)) + "px";
  highlight.style.height = Math.max(0, Math.round(rect.height)) + "px";
}

export function showSandboxCardHighlight(rect) {
  const highlight = getSandboxCardHighlightElement();
  if (!highlight) {
    return;
  }

  window.clearTimeout(state.sandboxCardHighlightPulseTimer);
  state.sandboxCardHighlightPulseTimer = 0;

  if (rect) {
    updateSandboxCardHighlightRect(rect);
  }

  highlight.style.setProperty("--cgptbm-sandbox-card-highlight-fade-duration", SANDBOX_CARD_HIGHLIGHT_FADE_IN_DURATION + "ms");
  highlight.classList.add("is-visible");

  state.sandboxCardHighlightPulseTimer = window.setTimeout(function () {
    state.sandboxCardHighlightPulseTimer = 0;
    highlight.style.setProperty("--cgptbm-sandbox-card-highlight-fade-duration", SANDBOX_CARD_HIGHLIGHT_FADE_OUT_DURATION + "ms");
    highlight.classList.remove("is-visible");
  }, SANDBOX_CARD_HIGHLIGHT_FADE_IN_DURATION + SANDBOX_CARD_HIGHLIGHT_HOLD_DURATION);
}

export function hideSandboxCardHighlight(options) {
  const highlight = getSandboxCardHighlightElement();
  if (!highlight) {
    return;
  }

  const nextOptions = options || {};
  window.clearTimeout(state.sandboxCardHighlightPulseTimer);
  state.sandboxCardHighlightPulseTimer = 0;

  if (nextOptions.immediate) {
    highlight.classList.remove("is-visible");
    return;
  }

  if (!highlight.classList.contains("is-visible")) {
    return;
  }

  highlight.style.setProperty("--cgptbm-sandbox-card-highlight-fade-duration", SANDBOX_CARD_HIGHLIGHT_EXIT_FADE_OUT_DURATION + "ms");
  highlight.classList.remove("is-visible");
}

function handleSandboxCardTriggerClick(candidate, position, event) {
  if (event) {
    event.preventDefault();
    event.stopPropagation();
  }

  if (!candidate) {
    return;
  }

  rememberClaudeSandboxCardCandidateFromElement(candidate.frame);
  if (_hideSelectionTrigger) _hideSelectionTrigger();
  if (_startBookmarkFlow) {
    _startBookmarkFlow({
      popupPosition: {
        top: position && Number.isFinite(position.popupTop) ? position.popupTop : 0,
        left: position && Number.isFinite(position.popupLeft) ? position.popupLeft : 0
      },
      fallbackAnchor: buildClaudeSandboxCardAnchor(candidate)
    });
  }
}

// ---- Exported functions ----

export function isClaudeSandboxCardContext() {
  const profile = getCurrentSiteProfile();
  return Boolean(profile && profile.id === "claude" && window.self === window.top);
}

export function isSandboxCardAnchor(anchor) {
  return Boolean(
    anchor &&
    (
      anchor.sandboxCard ||
      anchor.sandboxCardKey ||
      anchor.sandboxCardFrameHref ||
      anchor.sandboxCardFrameFingerprint ||
      anchor.sandboxCardFramePathFingerprint ||
      anchor.sandboxCardContainerFingerprint ||
      anchor.sandboxCardContainerPathFingerprint ||
      anchor.sandboxCardPositionFingerprint ||
      anchor.sandboxCardFingerprint
    )
  );
}

export function collectClaudeSandboxCardCandidates() {
  if (!isClaudeSandboxCardContext()) {
    return [];
  }

  const root = getScopeRoot();
  const frames = Array.from(root.querySelectorAll("iframe[sandbox]"));
  const candidates = frames
    .map(function (frame, domIndex) {
      return buildClaudeSandboxCardCandidate(frame, domIndex);
    })
    .filter(Boolean);

  return candidates.map(function (candidate, index) {
    const nextCandidate = Object.assign({}, candidate, {
      index: index
    });
    nextCandidate.key = buildClaudeSandboxCardKey(nextCandidate);
    return nextCandidate;
  });
}

export function rememberClaudeSandboxCardCandidateFromElement(element) {
  const candidate = findClaudeSandboxCardCandidateByElement(element);
  if (!candidate) {
    return;
  }

  state.lastSandboxCardKey = candidate.key;
  state.lastSandboxCardInteractedAt = Date.now();
}

export function findClaudeSandboxCardCandidateByElement(element) {
  if (!isClaudeSandboxCardContext() || !element) {
    return null;
  }

  const frame = element.tagName === "IFRAME"
    ? element
    : (element.closest ? element.closest("iframe[sandbox]") : null);
  if (!frame) {
    return null;
  }

  return collectClaudeSandboxCardCandidates().find(function (candidate) {
    return candidate.frame === frame;
  }) || null;
}

export function getClaudeSandboxCardCandidateAtPoint(clientX, clientY) {
  if (!isClaudeSandboxCardContext() || !Number.isFinite(clientX) || !Number.isFinite(clientY)) {
    return null;
  }

  const candidates = collectClaudeSandboxCardCandidates().filter(function (candidate) {
    return isRenderableSandboxCardCandidate(candidate);
  });

  let bestCandidate = null;
  let bestArea = -1;

  candidates.forEach(function (candidate) {
    const rect = getSandboxCardHoverRect(candidate);
    if (!rect) {
      return;
    }

    if (
      clientX < rect.left ||
      clientX > rect.right ||
      clientY < rect.top ||
      clientY > rect.bottom
    ) {
      return;
    }

    const area = rect.width * rect.height;
    if (!bestCandidate || area < bestArea || bestArea < 0) {
      bestCandidate = candidate;
      bestArea = area;
    }
  });

  return bestCandidate;
}

export function getSandboxCardHoverRect(candidate) {
  if (!candidate || !candidate.cardRect) {
    return null;
  }

  const trigger = computeSandboxCardTriggerPosition(candidate.cardRect);
  if (!trigger) {
    return candidate.cardRect;
  }

  const triggerRect = {
    left: trigger.left,
    top: trigger.top,
    right: trigger.left + SANDBOX_CARD_TRIGGER_WIDTH,
    bottom: trigger.top + SANDBOX_CARD_TRIGGER_HEIGHT
  };

  const left = Math.min(candidate.cardRect.left, triggerRect.left) - 4;
  const top = Math.min(candidate.cardRect.top, triggerRect.top) - 4;
  const right = Math.max(candidate.cardRect.right, triggerRect.right) + 4;
  const bottom = Math.max(candidate.cardRect.bottom, triggerRect.bottom) + SANDBOX_CARD_TRIGGER_HOVER_BRIDGE;

  return {
    left: left,
    top: top,
    right: right,
    bottom: bottom,
    width: Math.max(0, right - left),
    height: Math.max(0, bottom - top)
  };
}

export function captureClaudeSandboxCardAnchor() {
  const candidate = getPreferredClaudeSandboxCardCandidate();
  if (!candidate) {
    return null;
  }

  state.lastSandboxCardKey = candidate.key;
  state.lastSandboxCardInteractedAt = Date.now();
  return buildClaudeSandboxCardAnchor(candidate);
}

export function getPreferredClaudeSandboxCardCandidate() {
  const candidates = collectClaudeSandboxCardCandidates();
  const visibleCandidates = candidates.filter(function (candidate) {
    return candidate.visibleArea > 0;
  });
  if (!visibleCandidates.length) {
    return null;
  }

  const recentCandidate = getRecentClaudeSandboxCardCandidate(visibleCandidates);
  if (recentCandidate) {
    return recentCandidate;
  }

  let bestCandidate = null;
  let bestScore = -Infinity;
  const viewportFocusY = window.innerHeight * 0.38;

  visibleCandidates.forEach(function (candidate) {
    const rect = candidate.cardRect;
    const centerY = rect.top + (rect.height / 2);
    let score = (candidate.visibleArea / 1000) + (candidate.visibleRatio * 140) - (Math.abs(centerY - viewportFocusY) * 0.25);
    if (rect.top <= window.innerHeight * 0.52 && rect.bottom >= window.innerHeight * 0.12) {
      score += 36;
    }
    if (candidate.cardText) {
      score += 10;
    }

    if (!bestCandidate || score > bestScore) {
      bestCandidate = candidate;
      bestScore = score;
    }
  });

  return bestCandidate;
}

export function buildClaudeSandboxCardAnchor(candidate) {
  if (!candidate) {
    return null;
  }

  return {
    anchorId: candidate.anchorId || "",
    blockTag: candidate.card && candidate.card.tagName ? candidate.card.tagName.toLowerCase() : "iframe",
    blockFingerprint: candidate.cardFingerprint || "",
    messageFingerprint: "",
    messageRole: "assistant",
    blockIndex: -1,
    blockIndexInMessage: -1,
    messageIndex: -1,
    scrollRatio: Number.isFinite(candidate.scrollRatio) ? candidate.scrollRatio : 0.5,
    selectionText: "",
    selectionDisplayText: "",
    selectionTextRaw: "",
    blockTextSnippet: truncateText(candidate.cardText || "Claude sandbox widget", 220),
    selectionStart: -1,
    selectionLength: -1,
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
    sandboxCard: true,
    sandboxCardKey: candidate.key || "",
    sandboxCardIndex: candidate.index,
    sandboxCardFrameHref: candidate.frameHref || "",
    sandboxCardFrameName: candidate.frameName || "",
    sandboxCardFrameSandbox: candidate.frameSandbox || "",
    sandboxCardFrameFingerprint: candidate.frameFingerprint || "",
    sandboxCardFramePathFingerprint: candidate.framePathFingerprint || "",
    sandboxCardContainerFingerprint: candidate.containerFingerprint || "",
    sandboxCardContainerPathFingerprint: candidate.containerPathFingerprint || "",
    sandboxCardPositionFingerprint: candidate.positionFingerprint || "",
    sandboxCardDomIndex: Number.isInteger(candidate.domIndex) ? candidate.domIndex : -1,
    sandboxCardFrameSiblingIndex: Number.isInteger(candidate.sandboxSiblingIndex) ? candidate.sandboxSiblingIndex : -1,
    sandboxCardFingerprint: candidate.cardFingerprint || ""
  };
}

export function buildClaudeSandboxCardKey(candidate) {
  return fingerprintText([
    candidate && candidate.frameFingerprint || "",
    candidate && candidate.framePathFingerprint || "",
    candidate && candidate.containerFingerprint || "",
    candidate && candidate.positionFingerprint || "",
    candidate && candidate.cardFingerprint || "",
    String(candidate && candidate.domIndex),
    String(candidate && candidate.sandboxSiblingIndex),
    candidate && candidate.anchorId || "",
    candidate && candidate.containerId || ""
  ].join("|"));
}

export function isRenderableSandboxCardCandidate(candidate) {
  if (!candidate || !candidate.cardRect) {
    return false;
  }

  return candidate.visibleArea >= 4000 &&
    candidate.cardRect.width >= 180 &&
    candidate.cardRect.height >= 96 &&
    candidate.cardRect.bottom >= 18 &&
    candidate.cardRect.top <= window.innerHeight - 18;
}

export function computeSandboxCardTriggerPosition(cardRect) {
  if (!cardRect) {
    return null;
  }

  const left = clamp(
    Math.round(cardRect.right - SANDBOX_CARD_TRIGGER_WIDTH - 8),
    8,
    Math.max(8, window.innerWidth - SANDBOX_CARD_TRIGGER_WIDTH - 8)
  );
  const top = clamp(
    Math.round(cardRect.top - 32),
    8,
    Math.max(8, window.innerHeight - SANDBOX_CARD_TRIGGER_HEIGHT - 8)
  );

  return {
    left: left,
    top: top,
    popupTop: clamp(top + SANDBOX_CARD_TRIGGER_HEIGHT + 6, 10, Math.max(10, window.innerHeight - 80)),
    popupLeft: clamp(left + SANDBOX_CARD_TRIGGER_WIDTH - 168, 10, Math.max(10, window.innerWidth - 180))
  };
}

export function resolveSandboxCardTarget(anchor) {
  const candidates = collectClaudeSandboxCardCandidates();
  if (!candidates.length) {
    return null;
  }

  let bestCandidate = null;
  let bestScore = -Infinity;

  candidates.forEach(function (candidate) {
    let score = 0;

    if (anchor.anchorId && candidate.anchorId && candidate.anchorId === anchor.anchorId) {
      score += 110;
    }
    if (anchor.sandboxCardKey && candidate.key === anchor.sandboxCardKey) {
      score += 140;
    }
    if (anchor.sandboxCardFingerprint && candidate.cardFingerprint === anchor.sandboxCardFingerprint) {
      score += 90;
    } else if (anchor.blockFingerprint && candidate.cardFingerprint === anchor.blockFingerprint) {
      score += 72;
    }
    if (anchor.sandboxCardFrameHref && candidate.frameHref === anchor.sandboxCardFrameHref) {
      score += 84;
    }
    if (anchor.sandboxCardFrameName && candidate.frameName === anchor.sandboxCardFrameName) {
      score += 24;
    }
    if (anchor.sandboxCardFrameSandbox && candidate.frameSandbox === anchor.sandboxCardFrameSandbox) {
      score += 18;
    }
    if (anchor.sandboxCardFrameFingerprint && candidate.frameFingerprint === anchor.sandboxCardFrameFingerprint) {
      score += 108;
    }
    if (anchor.sandboxCardFramePathFingerprint && candidate.framePathFingerprint === anchor.sandboxCardFramePathFingerprint) {
      score += 128;
    }
    if (anchor.sandboxCardContainerFingerprint && candidate.containerFingerprint === anchor.sandboxCardContainerFingerprint) {
      score += 132;
    }
    if (anchor.sandboxCardContainerPathFingerprint && candidate.containerPathFingerprint === anchor.sandboxCardContainerPathFingerprint) {
      score += 96;
    }
    if (anchor.sandboxCardPositionFingerprint && candidate.positionFingerprint === anchor.sandboxCardPositionFingerprint) {
      score += 72;
    }
    if (Number.isInteger(anchor.sandboxCardDomIndex) && anchor.sandboxCardDomIndex >= 0) {
      score += Math.max(0, 42 - (Math.abs(anchor.sandboxCardDomIndex - candidate.domIndex) * 12));
    }
    if (Number.isInteger(anchor.sandboxCardFrameSiblingIndex) && anchor.sandboxCardFrameSiblingIndex >= 0) {
      score += Math.max(0, 28 - (Math.abs(anchor.sandboxCardFrameSiblingIndex - candidate.sandboxSiblingIndex) * 10));
    }
    if (Number.isInteger(anchor.sandboxCardIndex) && anchor.sandboxCardIndex >= 0) {
      score += Math.max(0, 20 - (Math.abs(anchor.sandboxCardIndex - candidate.index) * 6));
    }
    if (Number.isFinite(anchor.scrollRatio)) {
      score += Math.max(0, 18 - Math.round(Math.abs(anchor.scrollRatio - candidate.scrollRatio) * 64));
    }

    if (!bestCandidate || score > bestScore) {
      bestCandidate = candidate;
      bestScore = score;
    }
  });

  return bestCandidate ? bestCandidate.frame : null;
}

export function scheduleSandboxCardTriggerRender() {
  window.cancelAnimationFrame(state.sandboxCardRenderFrame);
  state.sandboxCardRenderFrame = window.requestAnimationFrame(function () {
    state.sandboxCardRenderFrame = 0;
    renderSandboxCardTriggers();
  });
}

export function renderSandboxCardTriggers() {
  const layer = state.sandboxCardLayer;
  if (!layer) {
    return;
  }

  Array.from(layer.querySelectorAll(".cgptbm-sandbox-card-trigger")).forEach(function (node) {
    node.remove();
  });

  if (!state.railEnabled || !isClaudeSandboxCardContext()) {
    hideSandboxCardHighlight();
    return;
  }

  const candidates = collectClaudeSandboxCardCandidates().filter(function (candidate) {
    return isRenderableSandboxCardCandidate(candidate);
  });
  if (!state.hoveredSandboxCardKey) {
    hideSandboxCardHighlight();
    return;
  }

  const candidate = candidates.find(function (entry) {
    return entry.key === state.hoveredSandboxCardKey;
  }) || null;
  if (!candidate) {
    hideSandboxCardHighlight();
    return;
  }

  updateSandboxCardHighlightRect(candidate.cardRect);

  const position = computeSandboxCardTriggerPosition(candidate.cardRect);
  if (!position) {
    return;
  }

  const button = document.createElement("button");
  button.type = "button";
  button.className = "cgptbm-sandbox-card-trigger";
  button.textContent = "MARK";
  button.title = "Mark Claude widget card";
  button.setAttribute("aria-label", "Mark Claude widget card");
  button.style.top = position.top + "px";
  button.style.left = position.left + "px";
  button.addEventListener("pointerenter", function () {
    showSandboxCardHighlight(candidate.cardRect);
  });
  button.addEventListener("pointerleave", function () {
    hideSandboxCardHighlight();
  });
  button.addEventListener("focus", function () {
    showSandboxCardHighlight(candidate.cardRect);
  });
  button.addEventListener("blur", function () {
    hideSandboxCardHighlight();
  });
  button.addEventListener("mousedown", function (event) {
    if (_preventFocusSteal) _preventFocusSteal(event);
    event.stopPropagation();
  });
  button.addEventListener("click", function (event) {
    handleSandboxCardTriggerClick(candidate, position, event);
  });
  layer.appendChild(button);
}
