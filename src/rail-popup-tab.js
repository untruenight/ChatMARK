// ============================================================
// rail-popup-tab.js — Tab/popup element creation (cluster facade)
// ============================================================
// Extracted from rail.js during Phase B modularization.
// Phase E1: popup geometry, resize, layout, overflow moved to
// rail-popup-geometry.js. This file remains the cluster facade.
// Phase E2: popup DOM creation and sync moved to
// rail-popup-dom.js. This file remains the cluster facade.
// Phase E3: tab DOM creation and action buttons moved to
// rail-tab-dom.js. This file remains the cluster facade.

import { normalizeText, normalizeInteger } from './text.js';
import { formatPopupDisplayText, extractStructuredPopupTextFromRange } from './capture.js';
import { isFrameRelayAnchor } from './bridge.js';
import { isSandboxCardAnchor } from './sandbox-card.js';
import { resolveBookmarkTarget, buildTargetTextMap, scoreOccurrenceEdge, matchesSelectionContextFingerprint } from './resolve.js';
import { resolvePreferredHighlightMatch } from './highlight.js';

// Geometry sub-module (Phase E1)
import {
  _initPopupGeometry,
  getPopupPositionForRect,
  getEditPopupPositionForTab,
  handlePopupResizePointerMove,
  handlePopupResizePointerEnd,
  beginPopupResizeSession,
  endPopupResizeSession,
  releaseResizeLockedExpandedBookmarkForInteraction,
  maybeReleaseResizeLockedExpandedBookmark,
  getPopupLayout,
  setPopupLayout,
  applyPopupResizeLocalLayout,
  applyPopupLayoutToElement,
  schedulePopupOverflowIndicatorSync,
  syncPopupOverflowIndicator,
  handlePopupContentExpand,
  handlePopupContentMinimize,
  resetExpandedBookmarkState
} from './rail-popup-geometry.js';

// DOM sub-module (Phase E2)
import {
  _initPopupDom,
  createTabPopupElement,
  syncTabPopupElement
} from './rail-popup-dom.js';

// Tab DOM sub-module (Phase E3)
import {
  _initTabDom,
  createTabElement,
  renderTabActionButtonContent,
  buildTabActionIcon
} from './rail-tab-dom.js';

// ============================================================
// Callback registry (injected via initPopupTab)
// ============================================================

var _callbacks = {
  onSyncRail: null,
  onSyncExpandedBookmarkState: null,
  getOrderedBookmarkTabs: null,
  getRenderedTabHeight: null,
  getRenderedSurfaceHeight: null,
  getRenderedPopupBottom: null,
  isPopupContentExpanded: null,
  setPopupContentExpanded: null,
  getNormalizedSearchQuery: null,
  highlightMatchInElement: null
};

export function initPopupTab(callbacks) {
  if (!callbacks || typeof callbacks !== "object") {
    return;
  }

  Object.keys(_callbacks).forEach(function (key) {
    if (typeof callbacks[key] === "function") {
      _callbacks[key] = callbacks[key];
    }
  });

  _initPopupGeometry(_callbacks);
  _initPopupDom(_callbacks);
  _initTabDom(_callbacks);
}

// ============================================================
// GROUP 16 — Text extraction
// ============================================================

export function extractResolvedSelectionText(bookmark) {
  const anchor = bookmark && bookmark.anchor ? bookmark.anchor : null;
  if (!anchor) {
    return "";
  }
  if (isFrameRelayAnchor(anchor) || isSandboxCardAnchor(anchor)) {
    return "";
  }

  const target = resolveBookmarkTarget(bookmark);
  if (!target) {
    return "";
  }

  const preferredMatch = resolvePreferredHighlightMatch(target, bookmark);
  if (preferredMatch && preferredMatch.match) {
    const preferredText = extractTextFromMatch(preferredMatch.match, {
      preserveWhitespace: preferredMatch.mode === "code"
    });
    if (preferredText) {
      return preferredText;
    }
  }

  const startIndex = normalizeInteger(anchor.selectionStart);
  const selectionLength = normalizeInteger(anchor.selectionLength);
  if (startIndex < 0 || selectionLength <= 0) {
    return "";
  }

  const textMap = buildTargetTextMap(target);
  if (!textMap || !textMap.normalizedText) {
    return "";
  }

  const clampedStart = Math.min(startIndex, textMap.normalizedText.length);
  const clampedEnd = Math.min(textMap.normalizedText.length, clampedStart + selectionLength);
  if (clampedEnd <= clampedStart) {
    return "";
  }

  const selectedText = textMap.normalizedText.slice(clampedStart, clampedEnd);
  const prefixText = textMap.normalizedText.slice(0, clampedStart);
  const suffixText = textMap.normalizedText.slice(clampedEnd);
  const prefixScore = scoreOccurrenceEdge(anchor.selectionPrefix, prefixText, true);
  const suffixScore = scoreOccurrenceEdge(anchor.selectionSuffix, suffixText, false);
  const contextFingerprintMatch = matchesSelectionContextFingerprint(anchor, prefixText, selectedText, suffixText);
  const storedSelection = normalizeText(anchor.selectionText || "");
  const selectionCompatible = !storedSelection ||
    selectedText === storedSelection ||
    selectedText.indexOf(storedSelection) === 0 ||
    storedSelection.indexOf(selectedText) === 0;

  if (!selectionCompatible && !contextFingerprintMatch && !prefixScore && !suffixScore) {
    return "";
  }

  return formatPopupDisplayText(selectedText);
}

function extractTextFromMatch(match, options) {
  if (!match || !match.startNode || !match.endNode) {
    return "";
  }

  const range = document.createRange();
  try {
    range.setStart(match.startNode, match.startOffset);
    range.setEnd(match.endNode, match.endOffset);
  } catch (error) {
    return "";
  }

  return extractStructuredPopupTextFromRange(range, options);
}

// ============================================================
// Re-exports from rail-popup-geometry.js (Phase E1)
// ============================================================

export {
  getPopupPositionForRect,
  getEditPopupPositionForTab,
  handlePopupResizePointerMove,
  handlePopupResizePointerEnd,
  beginPopupResizeSession,
  endPopupResizeSession,
  releaseResizeLockedExpandedBookmarkForInteraction,
  maybeReleaseResizeLockedExpandedBookmark,
  getPopupLayout,
  setPopupLayout,
  applyPopupResizeLocalLayout,
  applyPopupLayoutToElement,
  schedulePopupOverflowIndicatorSync,
  syncPopupOverflowIndicator,
  handlePopupContentExpand,
  handlePopupContentMinimize,
  resetExpandedBookmarkState
};

// ============================================================
// Re-exports from rail-popup-dom.js (Phase E2)
// ============================================================

export {
  createTabPopupElement,
  syncTabPopupElement
};

// ============================================================
// Re-exports from rail-tab-dom.js (Phase E3)
// ============================================================

export {
  createTabElement,
  renderTabActionButtonContent,
  buildTabActionIcon
};
