// ============================================================
// anchor/highlight.js — 타겟 요소를 시각적으로 하이라이트
// ============================================================
// 비유: "형광펜으로 밑줄 긋기". 찾은 타겟을 사용자에게 눈에 띄게 표시합니다.

import state from './state.js';
import {
  HIGHLIGHT_CLASS,
  POST_SCROLL_TARGET_TOP_OFFSET,
  POST_SCROLL_CONTAINER_PADDING,
  MESSAGE_SELECTOR
} from './constants.js';
import { normalizeText, clamp, normalizeInteger } from './text.js';
import {
  findMessageContainer, getMessageRole, getElementText,
  collectAnchorBlocks, findAnchorBlock, canElementContainText
} from './dom.js';
import { isCodeAnchor, formatPopupDisplayText } from './capture.js';
import {
  buildTargetTextMap, buildRawOffsetMatch, rawOffsetToDomPosition,
  findBestTextOccurrence, findBestCodeOccurrence,
  scoreOccurrenceEdge, matchesSelectionContextFingerprint,
  matchesCodeSelectionContextFingerprint,
  hasUserExactAnchor, findUserExactMatchInMessage
} from './resolve.js';
import { isSandboxCardAnchor } from './sandbox-card.js';

// ---- 콜백 슬롯 (scroll.js 순환 의존 방지) ----
let _advanceScrollProgress = null;
let _finishHiddenScrollTransaction = null;
let _forceHideScrollTransaction = null;
let _getOutputScrollBehavior = null;

export function setHighlightScrollCallbacks(callbacks) {
  _advanceScrollProgress = callbacks.advanceScrollProgress || null;
  _finishHiddenScrollTransaction = callbacks.finishHiddenScrollTransaction || null;
  _forceHideScrollTransaction = callbacks.forceHideScrollTransaction || null;
  _getOutputScrollBehavior = callbacks.getOutputScrollBehavior || null;
}

// ============================================================
// 하이라이트 스케줄링 & 실행
// ============================================================

export function scheduleTargetHighlight(target, bookmark, options) {
  const nextOptions = options || {};
  clearHighlightState();

  if (!target || !target.isConnected) {
    if (_finishHiddenScrollTransaction) _finishHiddenScrollTransaction();
    return;
  }

  if (nextOptions.immediate || isHighlightReferenceComfortablyVisible(target, nextOptions.precomputedMatch)) {
    if (_advanceScrollProgress) _advanceScrollProgress(0.58);
    runTargetHighlight(target, bookmark, nextOptions);
    return;
  }

  let stableTicks = 0;
  let attempts = 0;
  let previousTop = getHighlightReferenceTop(target, nextOptions.precomputedMatch);

  const waitForSettledScroll = function () {
    state.highlightStartTimer = 0;
    if (!target.isConnected) {
      if (_finishHiddenScrollTransaction) _finishHiddenScrollTransaction();
      return;
    }

    const currentTop = getHighlightReferenceTop(target, nextOptions.precomputedMatch);
    const settled = isHighlightReferenceComfortablyVisible(target, nextOptions.precomputedMatch) && Math.abs(currentTop - previousTop) <= 1.5;
    previousTop = currentTop;
    attempts += 1;
    stableTicks = settled ? stableTicks + 1 : 0;

    if (stableTicks >= 2 || attempts >= 18) {
      if (_advanceScrollProgress) _advanceScrollProgress(0.58);
      window.setTimeout(function () {
        if (!target.isConnected) {
          if (_finishHiddenScrollTransaction) _finishHiddenScrollTransaction();
          return;
        }
        runTargetHighlight(target, bookmark, nextOptions);
      }, 120);
      return;
    }

    state.highlightStartTimer = window.setTimeout(waitForSettledScroll, 70);
  };

  state.highlightStartTimer = window.setTimeout(waitForSettledScroll, 90);
  if (_advanceScrollProgress) _advanceScrollProgress(0.42);
}

function runTargetHighlight(target, bookmark, options) {
  const nextOptions = options || {};
  if (nextOptions.preferBlockHighlight || shouldPreferBlockHighlight(bookmark)) {
    pulseTarget(target);
    if (_finishHiddenScrollTransaction) _finishHiddenScrollTransaction();
    return;
  }

  const highlightResult = highlightInlineText(target, bookmark, nextOptions.precomputedMatch || null);
  if (highlightResult) {
    if (_advanceScrollProgress) _advanceScrollProgress(0.76);
    microScrollHighlightIntoView(highlightResult.node, highlightResult.mode);
    return;
  }

  // Intermediate: try sentence-level highlight before full-block pulse
  const sentenceResult = highlightNearestSentence(target, bookmark);
  if (sentenceResult) {
    microScrollHighlightIntoView(sentenceResult.node, "text");
    return;
  }

  pulseTarget(target);
  if (_finishHiddenScrollTransaction) _finishHiddenScrollTransaction();
}

function highlightNearestSentence(target, bookmark) {
  const anchor = bookmark && bookmark.anchor ? bookmark.anchor : null;
  const snippet = normalizeText(anchor && anchor.blockTextSnippet || "");
  if (!snippet || snippet.length < 20) return null;

  const text = getElementText(target);
  const shortSnippet = snippet.slice(0, 80);
  const index = normalizeText(text).toLowerCase().indexOf(shortSnippet.toLowerCase());
  if (index === -1) return null;

  const textMap = buildTargetTextMap(target);
  if (!textMap) return null;

  try {
    const match = { index: index, end: index + shortSnippet.length };
    const startPos = rawOffsetToDomPosition(textMap, match.index);
    const endPos = rawOffsetToDomPosition(textMap, match.end);
    if (!startPos || !endPos) return null;

    const range = document.createRange();
    range.setStart(startPos.node, startPos.offset);
    range.setEnd(endPos.node, endPos.offset);

    const wrapper = document.createElement("mark");
    wrapper.className = HIGHLIGHT_CLASS + "-inline";
    range.surroundContents(wrapper);
    state.highlightedInlineNode = wrapper;
    state.highlightedElement = target;

    window.clearTimeout(state.highlightTimer);
    state.highlightTimer = window.setTimeout(function () {
      if (state.highlightedInlineNode === wrapper) {
        unwrapHighlightNode(wrapper);
        state.highlightedInlineNode = null;
        state.highlightedElement = null;
      }
    }, 4200);

    return { node: wrapper, mode: "text" };
  } catch (error) {
    return null;
  }
}

function shouldPreferBlockHighlight(bookmark) {
  const anchor = bookmark && bookmark.anchor ? bookmark.anchor : null;
  if (isSandboxCardAnchor(anchor)) {
    return true;
  }
  if (!anchor || isCodeAnchor(anchor)) {
    return false;
  }

  const structuredDisplayText = formatPopupDisplayText(anchor.selectionDisplayText || "", false);
  if (!structuredDisplayText || structuredDisplayText.indexOf("\n") === -1) {
    return false;
  }

  const normalizedDisplayText = normalizeText(structuredDisplayText);
  const normalizedSelectionText = normalizeText(anchor.selectionText || "");
  if (!normalizedDisplayText) {
    return false;
  }

  return !normalizedSelectionText || normalizedDisplayText === normalizedSelectionText;
}

function pulseTarget(target) {
  clearHighlightState();
  target.classList.remove(HIGHLIGHT_CLASS);
  target.classList.remove(HIGHLIGHT_CLASS + "--residual");
  void target.offsetWidth;
  target.classList.add(HIGHLIGHT_CLASS);
  state.highlightedElement = target;

  window.clearTimeout(state.highlightTimer);
  // Phase 1: full highlight for 2 seconds
  state.highlightTimer = window.setTimeout(function () {
    if (state.highlightedElement === target) {
      // Phase 2: residual tint
      target.classList.remove(HIGHLIGHT_CLASS);
      target.classList.add(HIGHLIGHT_CLASS + "--residual");
      state.highlightTimer = window.setTimeout(function () {
        if (state.highlightedElement === target) {
          target.classList.remove(HIGHLIGHT_CLASS + "--residual");
          state.highlightedElement = null;
        }
      }, 4000);
    }
  }, 2000);
}

// ============================================================
// 하이라이트 상태 관리
// ============================================================

export function clearHighlightState() {
  state.navigateSessionId += 1;
  if (state.domStableObserver) {
    state.domStableObserver.disconnect();
    state.domStableObserver = null;
  }
  window.clearTimeout(state.highlightStartTimer);
  state.highlightStartTimer = 0;
  window.clearTimeout(state.highlightTimer);
  window.clearTimeout(state.postScrollTimer);
  state.postScrollTimer = 0;
  window.clearTimeout(state.scrollMaskRevealTimer);
  state.scrollMaskRevealTimer = 0;
  if (state.highlightedInlineNode && state.highlightedInlineNode.parentNode) {
    unwrapHighlightNode(state.highlightedInlineNode);
    state.highlightedInlineNode = null;
  }
  if (state.highlightedElement) {
    state.highlightedElement.classList.remove(HIGHLIGHT_CLASS);
    state.highlightedElement.classList.remove(HIGHLIGHT_CLASS + "--residual");
    state.highlightedElement = null;
  }
  if (state.scrollMask && !state.hiddenScrollActive && !state.scrollMask.hidden) {
    if (_forceHideScrollTransaction) _forceHideScrollTransaction();
  }
}

// ============================================================
// 인라인 하이라이트 핵심
// ============================================================

export function highlightInlineText(target, bookmark, precomputedMatch) {
  const preferredMatch = precomputedMatch || resolvePreferredHighlightMatch(target, bookmark);
  if (preferredMatch) {
    const preferredResult = applyResolvedHighlightMatch(preferredMatch);
    if (preferredResult) {
      return preferredResult;
    }
  }

  const anchor = bookmark && bookmark.anchor ? bookmark.anchor : null;
  const candidates = getHighlightCandidates(bookmark);

  // Phase 3 guard: skip expensive text map for large elements with no matching text
  if (!canElementContainText(target, candidates, anchor)) {
    return null;
  }

  const textMap = buildTargetTextMap(target);
  if (!textMap || !textMap.normalizedText) {
    return null;
  }

  for (let index = 0; index < candidates.length; index += 1) {
    const match = findTextMatch(textMap, candidates[index], anchor);
    if (!match) {
      continue;
    }

    const fallbackResult = applyResolvedHighlightMatch({
      match: match,
      mode: match.isCodeMatch ? "code" : "text",
      shouldCenterScroll: Boolean(
        (match.isCodeMatch && match.isStrongCodeMatch && isCodeAnchor(anchor)) ||
        (!match.isCodeMatch && match.isStrongTextMatch)
      )
    });
    if (fallbackResult) {
      return fallbackResult;
    }
  }

  return null;
}

export function resolvePreferredHighlightMatch(target, bookmark) {
  const anchor = bookmark && bookmark.anchor ? bookmark.anchor : null;
  if (hasUserExactAnchor(anchor)) {
    const message = getMessageElement(target);
    const exactResult = message ? findUserExactMatchInMessage(message, anchor) : null;
    if (exactResult && exactResult.match) {
      return {
        match: exactResult.match,
        mode: "text",
        shouldCenterScroll: true
      };
    }
  }

  const candidates = getHighlightCandidates(bookmark);

  // Phase 3 guard: skip expensive text map for large elements with no matching text
  if (!canElementContainText(target, candidates, anchor)) {
    return null;
  }

  const textMap = buildTargetTextMap(target);
  if (!textMap || !textMap.normalizedText) {
    return null;
  }

  for (let index = 0; index < candidates.length; index += 1) {
    const match = findTextMatch(textMap, candidates[index], anchor);
    if (!match) {
      continue;
    }

    const isStrongMatch = Boolean(
      (match.isCodeMatch && match.isStrongCodeMatch && isCodeAnchor(anchor)) ||
      (!match.isCodeMatch && match.isStrongTextMatch)
    );
    if (!isStrongMatch) {
      continue;
    }

    return {
      match: match,
      mode: match.isCodeMatch ? "code" : "text",
      shouldCenterScroll: true
    };
  }

  return null;
}

function applyResolvedHighlightMatch(matchInfo) {
  if (!matchInfo || !matchInfo.match) {
    return null;
  }

  const highlightNode = wrapTextMatch(matchInfo.match);
  if (!highlightNode) {
    return null;
  }

  state.highlightedInlineNode = highlightNode;
  state.highlightTimer = window.setTimeout(clearHighlightState, 2000);
  return {
    node: highlightNode,
    shouldMicroScroll: Boolean(matchInfo.shouldCenterScroll),
    mode: matchInfo.mode
  };
}

function stripTrailingEllipsis(text) {
  return text && text.endsWith("\u2026") ? text.slice(0, -1).trimEnd() : text;
}

function getHighlightCandidates(bookmark) {
  const anchor = bookmark && bookmark.anchor ? bookmark.anchor : null;
  const candidates = [
    anchor && stripTrailingEllipsis(anchor.selectionTextRaw),
    anchor && stripTrailingEllipsis(anchor.selectionText),
    bookmark && bookmark.snippet,
    anchor && anchor.blockTextSnippet
  ];

  return candidates
    .map(function (value) {
      return normalizeText(value);
    })
    .filter(function (value, index, list) {
      return value.length >= 2 && list.indexOf(value) === index;
    });
}

// ============================================================
// 텍스트 매칭
// ============================================================

export function findTextMatch(target, text, anchor) {
  if (!target) {
    return null;
  }

  // Code anchors: try code-specific matching first
  if (isCodeAnchor(anchor)) {
    const codeMatch = findCodeTextMatch(target, anchor);
    if (codeMatch) {
      return codeMatch;
    }
  }

  // Non-code anchors: literal text matching first (priority 1)
  const needle = normalizeText(text);
  if (needle) {
    const occurrence = findBestTextOccurrence(target.normalizedText, needle, anchor || null);
    if (occurrence) {
      const startMap = target.ranges[occurrence.index];
      const endMap = target.ranges[occurrence.end - 1];
      if (startMap && endMap) {
        const startPosition = rawOffsetToDomPosition(target.segments, startMap.start, false);
        const endPosition = rawOffsetToDomPosition(target.segments, endMap.end, true);
        if (startPosition && endPosition) {
          return {
            startNode: startPosition.node,
            startOffset: startPosition.offset,
            endNode: endPosition.node,
            endOffset: endPosition.offset,
            isCodeMatch: false,
            isStrongTextMatch: Boolean(
              occurrence.contextFingerprintMatch ||
              occurrence.distance <= 3 ||
              ((occurrence.prefixScore > 0 || occurrence.suffixScore > 0) && needle.length <= 36)
            )
          };
        }
      }
    }
  }

  // Offset-based matching as tiebreaker (priority 2)
  const directMatch = findDirectTextSelectionMatch(target, anchor);
  if (directMatch) {
    return directMatch;
  }

  return null;
}

function findDirectTextSelectionMatch(textMap, anchor) {
  if (!textMap || !textMap.normalizedText || !anchor) {
    return null;
  }

  const startIndex = normalizeInteger(anchor.selectionStart);
  const selectionLength = normalizeInteger(anchor.selectionLength);
  if (startIndex < 0 || selectionLength <= 0) {
    return null;
  }

  const clampedStart = Math.min(startIndex, textMap.normalizedText.length);
  const clampedEnd = Math.min(textMap.normalizedText.length, clampedStart + selectionLength);
  if (clampedEnd <= clampedStart) {
    return null;
  }

  const selectedText = textMap.normalizedText.slice(clampedStart, clampedEnd);
  const prefixText = textMap.normalizedText.slice(0, clampedStart);
  const suffixText = textMap.normalizedText.slice(clampedEnd);
  const prefixScore = scoreOccurrenceEdge(anchor.selectionPrefix, prefixText, true);
  const suffixScore = scoreOccurrenceEdge(anchor.selectionSuffix, suffixText, false);
  const contextFingerprintMatch = matchesSelectionContextFingerprint(anchor, prefixText, selectedText, suffixText);
  const storedSelection = normalizeText(anchor.selectionText || "");
  const selectionCompatible = !storedSelection || selectedText === storedSelection || selectedText.indexOf(storedSelection) === 0 || storedSelection.indexOf(selectedText) === 0;

  if (!selectionCompatible && !contextFingerprintMatch && !prefixScore && !suffixScore) {
    return null;
  }

  return buildNormalizedOffsetMatch(textMap, clampedStart, clampedEnd, {
    isCodeMatch: false,
    isStrongTextMatch: Boolean(selectionCompatible || contextFingerprintMatch || prefixScore > 0 || suffixScore > 0)
  });
}

function findCodeTextMatch(textMap, anchor) {
  if (!textMap || !textMap.rawText || !anchor) {
    return null;
  }

  const directStart = anchor.selectionCodeOffsetStart;
  const directEnd = anchor.selectionCodeOffsetEnd;
  const rawNeedle = String(anchor.selectionTextRaw || anchor.selectionText || "");

  if (
    rawNeedle &&
    Number.isInteger(directStart) &&
    Number.isInteger(directEnd) &&
    directStart >= 0 &&
    directEnd > directStart &&
    directEnd <= textMap.rawText.length
  ) {
    const directSlice = textMap.rawText.slice(directStart, directEnd);
    const directPrefix = textMap.rawText.slice(0, directStart);
    const directSuffix = textMap.rawText.slice(directEnd);
    if (directSlice === rawNeedle || matchesCodeSelectionContextFingerprint(anchor, directPrefix, directSlice, directSuffix)) {
      return buildRawOffsetMatch(textMap, directStart, directEnd, {
        isCodeMatch: true,
        isStrongCodeMatch: true
      });
    }
  }

  const occurrence = findBestCodeOccurrence(textMap.rawText, anchor);
  if (!occurrence) {
    return null;
  }

  return buildRawOffsetMatch(textMap, occurrence.index, occurrence.end, {
    isCodeMatch: true,
    isStrongCodeMatch: Boolean(
      occurrence.contextFingerprintMatch ||
      occurrence.distance <= 4 ||
      occurrence.lineScore >= 18
    )
  });
}

function buildNormalizedOffsetMatch(textMap, startIndex, endIndex, options) {
  if (!textMap || !Array.isArray(textMap.ranges) || !textMap.ranges.length) {
    return null;
  }

  const startMap = textMap.ranges[startIndex];
  const endMap = textMap.ranges[endIndex - 1];
  if (!startMap || !endMap) {
    return null;
  }

  const startPosition = rawOffsetToDomPosition(textMap.segments, startMap.start, false);
  const endPosition = rawOffsetToDomPosition(textMap.segments, endMap.end, true);
  if (!startPosition || !endPosition) {
    return null;
  }

  const nextOptions = options || {};
  return {
    startNode: startPosition.node,
    startOffset: startPosition.offset,
    endNode: endPosition.node,
    endOffset: endPosition.offset,
    isCodeMatch: Boolean(nextOptions.isCodeMatch),
    isStrongCodeMatch: Boolean(nextOptions.isStrongCodeMatch),
    isStrongTextMatch: Boolean(nextOptions.isStrongTextMatch)
  };
}

// ============================================================
// DOM 래핑 & 언래핑
// ============================================================

function wrapTextMatch(match) {
  if (!match || !match.startNode || !match.endNode) {
    return null;
  }

  if (match.startNode === match.endNode && match.startOffset >= match.endOffset) {
    return null;
  }

  try {
    const range = document.createRange();
    range.setStart(match.startNode, match.startOffset);
    range.setEnd(match.endNode, match.endOffset);
    if (range.collapsed) {
      return null;
    }

    const highlight = document.createElement("span");
    highlight.className = "cgptbm-inline-highlight";
    highlight.appendChild(range.extractContents());
    range.insertNode(highlight);
    return highlight;
  } catch (error) {
    return null;
  }
}

export function unwrapHighlightNode(node) {
  if (!node || !node.parentNode) {
    return;
  }

  const parent = node.parentNode;
  while (node.firstChild) {
    parent.insertBefore(node.firstChild, node);
  }
  parent.removeChild(node);
  parent.normalize();
}

// ============================================================
// 헬퍼 유틸리티
// ============================================================

function getMessageElement(element) {
  if (!element || !(element instanceof Element)) {
    return null;
  }

  if (element.matches && element.matches(MESSAGE_SELECTOR)) {
    return element;
  }

  return findMessageContainer(element);
}

// ============================================================
// 스크롤 정렬 & 뷰포트 가시성
// ============================================================

export function microScrollHighlightIntoView(node, mode) {
  if (!node || !node.getBoundingClientRect) {
    return;
  }

  runPostScrollAlignment(node, mode, 0);
}

function runPostScrollAlignment(node, mode, attempt) {
  if (!node || !node.isConnected || state.highlightedInlineNode !== node) {
    if (_forceHideScrollTransaction) _forceHideScrollTransaction();
    return;
  }

  if (_advanceScrollProgress) _advanceScrollProgress(Math.min(0.94, 0.84 + attempt * 0.06));
  const threshold = attempt >= 2 ? 2 : 6;
  const behavior = attempt === 0 ? "smooth" : "auto";
  const innerAligned = alignHighlightNodeWithinScrollableAncestor(node, mode, behavior, threshold);
  const pageAligned = alignHighlightNodeToTopOffset(node, mode, behavior, threshold);
  const aligned = innerAligned && pageAligned;

  if (aligned || attempt >= 3) {
    if (_finishHiddenScrollTransaction) _finishHiddenScrollTransaction();
    return;
  }

  window.clearTimeout(state.postScrollTimer);
  state.postScrollTimer = window.setTimeout(function () {
    state.postScrollTimer = 0;
    runPostScrollAlignment(node, mode, attempt + 1);
  }, attempt === 0 ? 180 : 70);
}

function getAdaptiveTopOffset(node, mode) {
  const message = findMessageContainer(node) || (node.parentElement || null);
  if (!message) return POST_SCROLL_TARGET_TOP_OFFSET;

  const messageRect = message.getBoundingClientRect();
  const nodeRect = node.getBoundingClientRect();
  const contextAbove = Math.min(nodeRect.top - messageRect.top, window.innerHeight * 0.25);

  if (mode === "code") {
    return Math.max(80, Math.min(nodeRect.top - contextAbove, window.innerHeight * 0.30));
  }
  return Math.max(80, Math.min(nodeRect.top - contextAbove, window.innerHeight * 0.25));
}

function alignHighlightNodeToTopOffset(node, mode, behavior, threshold) {
  if (!node || !node.getBoundingClientRect) {
    return true;
  }

  const rect = getHighlightAnchorRect(node, mode);
  if (!rect) {
    return true;
  }

  const targetOffset = getAdaptiveTopOffset(node, mode);
  const delta = rect.top - targetOffset;
  if (Math.abs(delta) <= threshold) {
    return true;
  }

  const maxScroll = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
  const nextTop = clamp(window.scrollY + delta, 0, maxScroll);
  if (Math.abs(nextTop - window.scrollY) <= 1) {
    return true;
  }

  window.scrollTo({
    top: nextTop,
    left: 0,
    behavior: _getOutputScrollBehavior ? _getOutputScrollBehavior(behavior || "smooth") : (behavior || "smooth")
  });
  return false;
}

function alignHighlightNodeWithinScrollableAncestor(node, mode, behavior, threshold) {
  if (!node || !node.isConnected) {
    return true;
  }

  const container = findNearestVerticalScrollableAncestor(node);
  if (!container) {
    return true;
  }

  const rect = getHighlightAnchorRect(node, mode);
  if (!rect) {
    return true;
  }

  const containerRect = container.getBoundingClientRect();
  const desiredTop = containerRect.top + POST_SCROLL_CONTAINER_PADDING;
  const delta = rect.top - desiredTop;
  if (Math.abs(delta) <= threshold) {
    return true;
  }

  const maxScrollTop = Math.max(0, container.scrollHeight - container.clientHeight);
  const nextTop = clamp(container.scrollTop + delta, 0, maxScrollTop);
  if (Math.abs(nextTop - container.scrollTop) <= 1) {
    return true;
  }

  if (typeof container.scrollTo === "function") {
    container.scrollTo({
      top: nextTop,
      left: container.scrollLeft,
      behavior: _getOutputScrollBehavior ? _getOutputScrollBehavior(behavior || "smooth") : (behavior || "smooth")
    });
  } else {
    container.scrollTop = nextTop;
  }

  return false;
}

function findNearestVerticalScrollableAncestor(node) {
  let current = node && node.parentElement ? node.parentElement : null;

  while (current && current !== document.body && current !== document.documentElement) {
    if (isVerticallyScrollableElement(current)) {
      return current;
    }
    current = current.parentElement;
  }

  return null;
}

function isVerticallyScrollableElement(element) {
  if (!element || !element.ownerDocument || !element.getBoundingClientRect) {
    return false;
  }

  if (element.scrollHeight <= element.clientHeight + 1) {
    return false;
  }

  const style = window.getComputedStyle(element);
  if (!style) {
    return false;
  }

  return /(auto|scroll|overlay)/.test(style.overflowY || "") || /(auto|scroll|overlay)/.test(style.overflow || "");
}

function getHighlightAnchorRect(node, mode) {
  if (!node) {
    return null;
  }

  const rects = node.getClientRects ? Array.from(node.getClientRects()) : [];
  const visibleRects = rects.filter(function (rect) {
    return rect && (rect.width || rect.height);
  });

  if (visibleRects.length) {
    visibleRects.sort(function (left, right) {
      if (Math.abs(left.top - right.top) > 1) {
        return left.top - right.top;
      }
      return left.left - right.left;
    });
    // Adaptive rect selection based on line count
    if (visibleRects.length <= 2) {
      return visibleRects[0];
    }
    if (visibleRects.length <= 4) {
      return visibleRects[Math.floor(visibleRects.length / 2)];
    }
    return visibleRects[0];
  }

  if (!node.getBoundingClientRect) {
    return;
  }

  const rect = node.getBoundingClientRect();
  if (!rect.height && !rect.width) {
    return null;
  }

  return rect;
}

export function getMatchClientRect(match) {
  if (!match || !match.startNode || !match.endNode) {
    return null;
  }

  try {
    const range = document.createRange();
    range.setStart(match.startNode, match.startOffset);
    range.setEnd(match.endNode, match.endOffset);
    if (range.collapsed) {
      return null;
    }

    const rect = range.getBoundingClientRect();
    if (rect && (rect.width || rect.height)) {
      return rect;
    }
  } catch (error) {
    return null;
  }

  return null;
}

export function scrollResolvedMatchIntoView(matchInfo) {
  if (!matchInfo || !matchInfo.match) {
    return {
      didScroll: false,
      reason: "missing-match"
    };
  }

  const rect = getMatchClientRect(matchInfo.match);
  if (!rect) {
    return {
      didScroll: false,
      reason: "missing-rect"
    };
  }

  return scrollRectIntoViewCenter(rect, matchInfo.mode);
}

function scrollRectIntoViewCenter(rect, mode) {
  if (!rect) {
    return {
      didScroll: false,
      reason: "missing-rect"
    };
  }

  const isCodeMode = mode === "code";
  const focusCenter = Math.round(window.innerHeight * (isCodeMode ? 0.34 : 0.38));
  const currentCenter = rect.top + rect.height / 2;
  const delta = currentCenter - focusCenter;

  if (Math.abs(delta) <= (isCodeMode ? 24 : 16)) {
    return {
      didScroll: false,
      reason: "within-threshold"
    };
  }

  const maxScroll = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
  const nextTop = clamp(window.scrollY + delta, 0, maxScroll);
  if (Math.abs(nextTop - window.scrollY) <= 1) {
    return {
      didScroll: false,
      reason: "no-scroll-room"
    };
  }

  window.scrollTo({
    top: nextTop,
    left: 0,
    behavior: _getOutputScrollBehavior ? _getOutputScrollBehavior("smooth") : "smooth"
  });
  return {
    didScroll: true,
    reason: "rect-centered"
  };
}

export function isTargetComfortablyVisible(target) {
  if (!target || !target.getBoundingClientRect) {
    return false;
  }

  return isRectComfortablyVisible(target.getBoundingClientRect());
}

function isHighlightReferenceComfortablyVisible(target, matchInfo) {
  const rect = getHighlightReferenceRect(target, matchInfo);
  return isRectComfortablyVisible(rect);
}

function getHighlightReferenceTop(target, matchInfo) {
  const rect = getHighlightReferenceRect(target, matchInfo);
  return rect ? rect.top + rect.height / 2 : 0;
}

function getHighlightReferenceRect(target, matchInfo) {
  if (matchInfo && matchInfo.match) {
    return getMatchClientRect(matchInfo.match);
  }
  if (!target || !target.getBoundingClientRect) {
    return null;
  }
  return target.getBoundingClientRect();
}

function isRectComfortablyVisible(rect) {
  if (!rect) {
    return false;
  }

  const topBoundary = 84;
  const bottomBoundary = 40;
  const visibleTop = Math.max(rect.top, topBoundary);
  const visibleBottom = Math.min(rect.bottom, window.innerHeight - bottomBoundary);
  const visibleHeight = Math.max(0, visibleBottom - visibleTop);
  const desiredVisibleHeight = Math.min(rect.height, 120);

  return visibleHeight >= desiredVisibleHeight;
}
