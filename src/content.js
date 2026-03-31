// ============================================================
// content.js — 엔트리포인트 (부트스트랩 + 글로벌 이벤트 바인딩 + 콜백 와이어링)
// ============================================================
// 비유: "건물의 정문". 방문객(이벤트)을 맞이하고 적절한 부서(모듈)로 안내합니다.
//
// 이 파일은 빌드 시 esbuild가 모든 import를 하나의 IIFE로 번들합니다.
// `npm run build` → dist/content.js (크롬 익스텐션이 로드하는 파일)
// ============================================================

// --- State & Constants ---
import { storageGet, storageSet } from './storage.js';
import { logWarn } from './log.js';
import state from './state.js';
import {
  ROOT_ID,
  RAIL_OPACITY_STORAGE_KEY,
  RAIL_ENABLED_STORAGE_KEY,
  BOOKMARK_SHARD_INDEX_STORAGE_KEY,
  PRIMARY_STORAGE_KEY,
  POPUP_LAYOUT_STORAGE_KEY,
  BOOKMARK_UI_STATE_STORAGE_KEY,
  LEGACY_STORAGE_KEYS,
  SELECTION_TRIGGER_LABEL,
  ROOT_RIGHT_OFFSET,
  RAIL_VIEWPORT_DEFAULT_TOP,
  RAIL_VIEWPORT_WIDTH,
  RAIL_LAYER_LEFT_BLEED,
  RAIL_LAYER_RIGHT_BLEED,
  DEFAULT_RAIL_OPACITY,
  APP_VERSION,
  UPDATE_DISMISSED_STORAGE_KEY,
  RELEASE_NOTES
} from './constants.js';

// --- Store ---
import {
  getCurrentUrlKey,
  normalizeUrlKey,
  loadBookmarks,
  normalizeBookmarkShardIndexMap,
  normalizeBookmarkList,
  getBookmarkShardBucketStorageKey,
  getBookmarkUiStateShardStorageKey,
  getPopupLayoutShardStorageKey,
  getBookmarkShardUrlHash,
  applyCurrentBookmarks,
  looksLikeUrl,
  normalizeRailOpacity,
  normalizeRailEnabled,
  buildSingleBucketObject,
  setBookmarkCallbacks
} from './bookmarks.js';

import {
  normalizePopupLayoutMap,
  buildSingleBookmarkUiStateObject,
  applyCurrentBookmarkUiState,
  deletePopupLayout,
  sanitizeBookmarkInteractionIds,
  normalizeManualOrderBookmarkIds,
  removeBookmarkInteractionId,
  persistBookmarkUiState,
  persistPopupLayouts,
  normalizeBookmarkUiStateEntry,
  normalizeBookmarkUiStateMap,
  hasMeaningfulBookmarkUiStateEntry,
  setUiStateCallbacks,
  invalidateAllBulkBackups
} from './ui-state.js';

import {
  loadLegacyBookmarksForCurrentUrl,
  migrateLegacyBookmarksToBookmarkShard,
  loadLegacyBookmarkUiStateForCurrentUrl,
  migrateLegacyBookmarkUiStateToShard,
  loadLegacyPopupLayoutsForCurrentUrl,
  migrateLegacyPopupLayoutsToShard,
  setMigrationCallbacks
} from './migration.js';

// --- UI: Rail ---
import {
  renderBookmarks,
  applyRailOpacity,
  releaseResizeLockedExpandedBookmarkForInteraction,
  refreshCurrentBookmarksViewAfterIncrementalRemove,
  refreshCurrentBookmarksViewAfterIncrementalUpdate,
  refreshCurrentBookmarksViewAfterIncrementalCreate,
  syncExpandedBookmarkState,
  isBookmarkExpanded,
  showAddTabSuccess,
  pulseRenderedBookmarkTab,
  pulseTab,
  resetAddTabFeedback,
  syncBookmarkHistoryControlsToCurrentRail,
  getPopupLayout,
  isPopupContentExpanded,
  setPopupContentExpanded,
  handleDocumentPointerDown,
  handleDocumentPointerMove,
  handleDocumentFocusIn,
  handleDocumentWheel,
  handleRailScrollbarPointerMove,
  handleRailScrollbarPointerEnd,
  handleBookmarkDragPointerEnd,
  handlePopupResizePointerMove,
  handlePopupResizePointerEnd,
  endPopupResizeSession,
  preCollapseGuard,
  resetExpandedBookmarkState,
  syncRailOverlayScroll,
  handleRailViewportWheel,
  bindRailScrollbar,
  bindTopRightUiProtectionObserver,
  scheduleTopRightUiProtectionRefresh,
  setBookmarkSearchQuery,
  clearActiveState
} from './rail.js';

// --- UI: Popup ---
import {
  openSavePopup,
  closeSavePopup,
  closeBookmarkColorPicker,
  normalizePopupLayout,
  setPopupCallbacks
} from './popup.js';

// --- UI: Selection ---
import {
  hideSelectionTrigger,
  scheduleSelectionUiUpdate,
  handleSelectionTriggerClick,
  startBookmarkFlow,
  showSelectionTrigger,
  computeSelectionUiPosition,
  isSelectionInsideEditableTextSurface,
  getSelectionClientRect,
  getSelectionElement,
  isEditableTextSelectionTarget,
  setSelectionCallbacks
} from './selection.js';

// --- UI: History ---
import {
  pushUndoBookmarkHistory,
  buildBookmarkHistoryEntry,
  buildStateChangeEntry,
  setHistoryCallbacks
} from './history.js';

// --- UI: Scroll ---
import {
  advanceScrollProgress,
  finishHiddenScrollTransaction,
  forceHideScrollTransaction,
  getOutputScrollBehavior
} from './scroll.js';

// --- Anchor: Highlight ---
import {
  clearHighlightState,
  setHighlightScrollCallbacks
} from './highlight.js';

// --- Frame Relay ---
import {
  bindFrameRelayBridge,
  syncFrameRelayDebugState,
  handleFrameRelayMessage,
  debugFrameRelay,
  normalizeFrameRelayUrl,
  getCurrentFrameRelayKey,
  setFrameRelayUiCallbacks
} from './bridge.js';

import {
  scheduleSandboxCardTriggerRender,
  setSandboxCardUiCallbacks
} from './sandbox-card.js';

// --- Anchor: Capture ---
import { setCaptureSelectionCallbacks, setCaptureResolveCallbacks } from './capture.js';

// --- Anchor: Resolve (capture 콜백 와이어링용) ---
import { buildTargetTextMap, domPositionToRawOffset } from './resolve.js';


// ============================================================
// 콜백 와이어링 — 순환 의존 방지를 위한 콜백 주입
// ============================================================

function preventFocusSteal(event) {
  event.preventDefault();
}

// bridge.js ← selection UI 콜백
setFrameRelayUiCallbacks({
  showSelectionTrigger: showSelectionTrigger,
  hideSelectionTrigger: hideSelectionTrigger,
  computeSelectionUiPosition: computeSelectionUiPosition,
  isSelectionInsideEditableTextSurface: isSelectionInsideEditableTextSurface,
  getSelectionClientRect: getSelectionClientRect
});

// sandbox-card.js ← selection + UI 콜백
setSandboxCardUiCallbacks({
  hideSelectionTrigger: hideSelectionTrigger,
  startBookmarkFlow: startBookmarkFlow,
  preventFocusSteal: preventFocusSteal
});

// capture.js ← selection 콜백
setCaptureSelectionCallbacks({
  getSelectionElement: getSelectionElement,
  isEditableTextSelectionTarget: isEditableTextSelectionTarget
});

// capture.js ← resolve 콜백 (순환 의존 방지)
setCaptureResolveCallbacks({
  buildTargetTextMap: buildTargetTextMap,
  domPositionToRawOffset: domPositionToRawOffset
});

// highlight.js ← scroll 콜백
setHighlightScrollCallbacks({
  advanceScrollProgress: advanceScrollProgress,
  finishHiddenScrollTransaction: finishHiddenScrollTransaction,
  forceHideScrollTransaction: forceHideScrollTransaction,
  getOutputScrollBehavior: getOutputScrollBehavior
});

// bookmarks.js ← UI + ui-state + migration 콜백 (22개)
setBookmarkCallbacks({
  // UI 콜백 (rail.js)
  renderBookmarks: renderBookmarks,
  applyRailOpacity: applyRailOpacity,
  releaseResizeLockedExpandedBookmarkForInteraction: releaseResizeLockedExpandedBookmarkForInteraction,
  refreshCurrentBookmarksViewAfterIncrementalRemove: refreshCurrentBookmarksViewAfterIncrementalRemove,
  // UI 콜백 (history.js)
  pushUndoBookmarkHistory: pushUndoBookmarkHistory,
  buildBookmarkHistoryEntry: buildBookmarkHistoryEntry,
  buildStateChangeEntry: buildStateChangeEntry,
  // ui-state 콜백 (ui-state.js)
  applyCurrentBookmarkUiState: applyCurrentBookmarkUiState,
  deletePopupLayout: deletePopupLayout,
  sanitizeBookmarkInteractionIds: sanitizeBookmarkInteractionIds,
  normalizeManualOrderBookmarkIds: normalizeManualOrderBookmarkIds,
  removeBookmarkInteractionId: removeBookmarkInteractionId,
  persistBookmarkUiState: persistBookmarkUiState,
  persistPopupLayouts: persistPopupLayouts,
  normalizeBookmarkUiStateEntry: normalizeBookmarkUiStateEntry,
  normalizePopupLayoutMap: normalizePopupLayoutMap,
  buildSingleBookmarkUiStateObject: buildSingleBookmarkUiStateObject,
  // migration 콜백 (migration.js)
  loadLegacyBookmarksForCurrentUrl: loadLegacyBookmarksForCurrentUrl,
  migrateLegacyBookmarksToBookmarkShard: migrateLegacyBookmarksToBookmarkShard,
  loadLegacyBookmarkUiStateForCurrentUrl: loadLegacyBookmarkUiStateForCurrentUrl,
  migrateLegacyBookmarkUiStateToShard: migrateLegacyBookmarkUiStateToShard,
  loadLegacyPopupLayoutsForCurrentUrl: loadLegacyPopupLayoutsForCurrentUrl,
  migrateLegacyPopupLayoutsToShard: migrateLegacyPopupLayoutsToShard
});

// migration.js ← ui-state 콜백 (4개)
setMigrationCallbacks({
  normalizeBookmarkUiStateMap: normalizeBookmarkUiStateMap,
  normalizeBookmarkUiStateEntry: normalizeBookmarkUiStateEntry,
  hasMeaningfulBookmarkUiStateEntry: hasMeaningfulBookmarkUiStateEntry,
  normalizePopupLayoutMap: normalizePopupLayoutMap
});

// ui-state.js ← rail + popup 콜백 (3개)
setUiStateCallbacks({
  releaseResizeLockedExpandedBookmarkForInteraction: releaseResizeLockedExpandedBookmarkForInteraction,
  syncExpandedBookmarkState: syncExpandedBookmarkState,
  syncHistoryControls: syncBookmarkHistoryControlsToCurrentRail,
  pushStateChangeEntry: function (action) {
    pushUndoBookmarkHistory(buildStateChangeEntry(action));
  },
  normalizePopupLayout: normalizePopupLayout,
  preCollapseGuard: preCollapseGuard
});

// popup.js ← rail + selection 콜백 (10개)
setPopupCallbacks({
  syncExpandedBookmarkState: syncExpandedBookmarkState,
  releaseResizeLockedExpandedBookmarkForInteraction: releaseResizeLockedExpandedBookmarkForInteraction,
  refreshCurrentBookmarksViewAfterIncrementalUpdate: refreshCurrentBookmarksViewAfterIncrementalUpdate,
  refreshCurrentBookmarksViewAfterIncrementalCreate: refreshCurrentBookmarksViewAfterIncrementalCreate,
  showAddTabSuccess: showAddTabSuccess,
  pulseRenderedBookmarkTab: pulseRenderedBookmarkTab,
  pulseTab: pulseTab,
  resetAddTabFeedback: resetAddTabFeedback,
  isBookmarkExpanded: isBookmarkExpanded,
  hideSelectionTrigger: hideSelectionTrigger
});

// selection.js ← popup 콜백 (1개)
setSelectionCallbacks({
  openSavePopup: openSavePopup
});

// history.js ← rail 콜백 (5개)
setHistoryCallbacks({
  pulseTab: pulseTab,
  syncBookmarkHistoryControlsToCurrentRail: syncBookmarkHistoryControlsToCurrentRail,
  getPopupLayout: getPopupLayout,
  isPopupContentExpanded: isPopupContentExpanded,
  setPopupContentExpanded: setPopupContentExpanded
});


// ============================================================
// 엔트리포인트 — 중복 실행 방지 + iframe 분기 + 부트스트랩
// ============================================================

(function () {
  if (window.__cgptBookmarkTabsInitialized) {
    return;
  }
  window.__cgptBookmarkTabsInitialized = true;

  // iframe인 경우 프레임 릴레이 브릿지만 바인딩
  if (window.self !== window.top) {
    debugFrameRelay("frame-bridge-bootstrap", {
      href: normalizeFrameRelayUrl(window.location.href),
      referrer: normalizeFrameRelayUrl(document.referrer),
      frameRelayKey: getCurrentFrameRelayKey()
    });
    bindFrameRelayBridge();
    return;
  }

  // 최상위 프레임 — 전체 부트스트랩
  bootstrap();

  function bootstrap() {
    const start = function () {
      state.currentUrlKey = getCurrentUrlKey();
      state.lastHref = window.location.href;
      mountUi();
      bindGlobalListeners();
      syncFrameRelayDebugState();
      scheduleSandboxCardTriggerRender();
      loadBookmarks();
      showUpdateBannerIfNeeded();
    };

    if (document.body) {
      start();
      return;
    }

    window.addEventListener("DOMContentLoaded", start, { once: true });
  }

  // ---- mountUi: DOM 구조 생성 또는 기존 구조 재활용 ----
  function mountUi() {
    const existingRoot = document.getElementById(ROOT_ID);
    if (existingRoot) {
      const existingViewport = existingRoot.querySelector(".cgptbm-rail-viewport");
      const existingScrollHitbox = existingRoot.querySelector(".cgptbm-rail-scroll-hitbox");
      const existingLayerViewport = existingRoot.querySelector(".cgptbm-rail-layer-viewport");
      const existingSpacer = existingRoot.querySelector(".cgptbm-rail-scroll-spacer");
      const existingScrollbar = existingRoot.querySelector(".cgptbm-rail-scrollbar");
      const existingScrollbarTrack = existingRoot.querySelector(".cgptbm-rail-scrollbar-track");
      const existingScrollbarThumb = existingRoot.querySelector(".cgptbm-rail-scrollbar-thumb");
      const existingLayer = existingRoot.querySelector(".cgptbm-layer");
      const existingSandboxCardLayer = existingRoot.querySelector(".cgptbm-sandbox-card-layer");
      if (
        !existingViewport ||
        !existingScrollHitbox ||
        !existingLayerViewport ||
        !existingSpacer ||
        !existingScrollbar ||
        !existingScrollbarTrack ||
        !existingScrollbarThumb ||
        !existingLayer ||
        !existingSandboxCardLayer
      ) {
        existingRoot.remove();
      } else {
      state.root = existingRoot;
      state.root.style.setProperty("--cgptbm-root-right", ROOT_RIGHT_OFFSET + "px");
      state.root.style.setProperty("--cgptbm-rail-viewport-top", RAIL_VIEWPORT_DEFAULT_TOP + "px");
      state.root.style.setProperty("--cgptbm-rail-viewport-width", RAIL_VIEWPORT_WIDTH + "px");
      state.root.style.setProperty("--cgptbm-rail-scroll-hitbox-width", RAIL_VIEWPORT_WIDTH + "px");
      state.root.style.setProperty("--cgptbm-rail-layer-left-bleed", RAIL_LAYER_LEFT_BLEED + "px");
      state.root.style.setProperty("--cgptbm-rail-overlay-right", RAIL_LAYER_RIGHT_BLEED + "px");
      state.railViewport = existingViewport;
      state.railScrollHitbox = existingScrollHitbox;
      state.railLayerViewport = existingLayerViewport;
      state.railScrollSpacer = existingSpacer;
      state.railScrollbar = existingScrollbar;
      state.railScrollbarTrack = existingScrollbarTrack;
      state.railScrollbarThumb = existingScrollbarThumb;
      if (existingLayer.parentElement !== existingLayerViewport) {
        existingLayerViewport.appendChild(existingLayer);
      }
      state.layer = existingLayer;
      const existingAddTab = state.root.querySelector(".cgptbm-tab--add");
      if (existingAddTab) {
        existingAddTab.remove();
      }
      state.addTab = null;
      state.searchInput = state.root.querySelector(".cgptbm-history-controls__search-input");
      state.searchClearButton = state.root.querySelector(".cgptbm-history-controls__search-clear");
      state.searchStatus = state.root.querySelector(".cgptbm-history-controls__search-status");
      state.selectionTrigger = state.root.querySelector(".cgptbm-selection-trigger");
      state.sandboxCardLayer = existingSandboxCardLayer;
      state.scrollMask = document.querySelector(".cgptbm-transition-mask");
      state.scrollProgressFill = state.scrollMask
        ? state.scrollMask.querySelector(".cgptbm-transition-mask__progress-fill")
        : null;
      applyRailOpacity();
      state.railViewport.onscroll = syncRailOverlayScroll;
      state.railViewport.onwheel = null;
      state.railScrollHitbox.onwheel = handleRailViewportWheel;
      state.railScrollbar.onwheel = handleRailViewportWheel;
      state.layer.onwheel = handleRailViewportWheel;
      bindRailScrollbar(existingScrollbar, existingScrollbarTrack, existingScrollbarThumb);
      bindTopRightUiProtectionObserver();
      scheduleTopRightUiProtectionRefresh();
      return;
      }
    }

    const root = document.createElement("div");
    root.id = ROOT_ID;
    root.style.setProperty("--cgptbm-root-right", ROOT_RIGHT_OFFSET + "px");
    root.style.setProperty("--cgptbm-rail-viewport-top", RAIL_VIEWPORT_DEFAULT_TOP + "px");
    root.style.setProperty("--cgptbm-rail-viewport-width", RAIL_VIEWPORT_WIDTH + "px");
    root.style.setProperty("--cgptbm-rail-scroll-hitbox-width", RAIL_VIEWPORT_WIDTH + "px");
    root.style.setProperty("--cgptbm-rail-layer-left-bleed", RAIL_LAYER_LEFT_BLEED + "px");
    root.style.setProperty("--cgptbm-rail-overlay-right", RAIL_LAYER_RIGHT_BLEED + "px");

    const railViewport = document.createElement("div");
    railViewport.className = "cgptbm-rail-viewport";
    railViewport.onscroll = syncRailOverlayScroll;

    const railScrollSpacer = document.createElement("div");
    railScrollSpacer.className = "cgptbm-rail-scroll-spacer";
    railViewport.appendChild(railScrollSpacer);
    root.appendChild(railViewport);

    const railScrollHitbox = document.createElement("div");
    railScrollHitbox.className = "cgptbm-rail-scroll-hitbox";
    railScrollHitbox.onwheel = handleRailViewportWheel;
    root.appendChild(railScrollHitbox);

    const railLayerViewport = document.createElement("div");
    railLayerViewport.className = "cgptbm-rail-layer-viewport";
    root.appendChild(railLayerViewport);

    const railScrollbar = document.createElement("div");
    railScrollbar.className = "cgptbm-rail-scrollbar";
    railScrollbar.hidden = true;
    railScrollbar.onwheel = handleRailViewportWheel;

    const railScrollbarTrack = document.createElement("div");
    railScrollbarTrack.className = "cgptbm-rail-scrollbar-track";

    const railScrollbarThumb = document.createElement("button");
    railScrollbarThumb.type = "button";
    railScrollbarThumb.className = "cgptbm-rail-scrollbar-thumb";
    railScrollbarThumb.setAttribute("aria-label", "Scroll bookmark rail");

    railScrollbarTrack.appendChild(railScrollbarThumb);
    railScrollbar.appendChild(railScrollbarTrack);
    root.appendChild(railScrollbar);

    const layer = document.createElement("div");
    layer.className = "cgptbm-layer";
    layer.onwheel = handleRailViewportWheel;
    railLayerViewport.appendChild(layer);

    const selectionTrigger = document.createElement("button");
    selectionTrigger.type = "button";
    selectionTrigger.className = "cgptbm-selection-trigger";
    selectionTrigger.textContent = SELECTION_TRIGGER_LABEL;
    selectionTrigger.hidden = true;
    selectionTrigger.addEventListener("mousedown", preventFocusSteal);
    selectionTrigger.addEventListener("click", handleSelectionTriggerClick);
    root.appendChild(selectionTrigger);

    const sandboxCardLayer = document.createElement("div");
    sandboxCardLayer.className = "cgptbm-sandbox-card-layer";
    root.appendChild(sandboxCardLayer);

    const scrollMask = document.createElement("div");
    scrollMask.className = "cgptbm-transition-mask";
    scrollMask.hidden = true;
    scrollMask.innerHTML = [
      '<div class="cgptbm-transition-mask__progress" aria-hidden="true">',
      '<div class="cgptbm-transition-mask__progress-fill"></div>',
      "</div>"
    ].join("");
    document.body.appendChild(scrollMask);
    document.body.appendChild(root);

    state.root = root;
    state.railViewport = railViewport;
    state.railScrollHitbox = railScrollHitbox;
    state.railLayerViewport = railLayerViewport;
    state.railScrollSpacer = railScrollSpacer;
    state.railScrollbar = railScrollbar;
    state.railScrollbarTrack = railScrollbarTrack;
    state.railScrollbarThumb = railScrollbarThumb;
    state.searchInput = null;
    state.searchClearButton = null;
    state.searchStatus = null;
    state.layer = layer;
    state.addTab = null;
    state.selectionTrigger = selectionTrigger;
    state.sandboxCardLayer = sandboxCardLayer;
    state.scrollMask = scrollMask;
    state.scrollProgressFill = scrollMask.querySelector(".cgptbm-transition-mask__progress-fill");
    applyRailOpacity();
    bindRailScrollbar(railScrollbar, railScrollbarTrack, railScrollbarThumb);
    bindTopRightUiProtectionObserver();
    scheduleTopRightUiProtectionRefresh();
  }

  // ---- bindGlobalListeners: 전역 이벤트 등록 ----
  function bindGlobalListeners() {
    chrome.storage.onChanged.addListener(handleStorageChanged);
    window.addEventListener("resize", renderBookmarks);
    window.addEventListener("resize", hideSelectionTrigger);
    window.addEventListener("resize", scheduleSandboxCardTriggerRender);
    window.addEventListener("resize", scheduleTopRightUiProtectionRefresh);
    window.addEventListener("pointermove", handleRailScrollbarPointerMove, true);
    window.addEventListener("pointerup", handleRailScrollbarPointerEnd, true);
    window.addEventListener("pointercancel", handleRailScrollbarPointerEnd, true);
    window.addEventListener("pointerup", handleBookmarkDragPointerEnd, true);
    window.addEventListener("pointercancel", handleBookmarkDragPointerEnd, true);
    window.addEventListener("keydown", handleKeydown, true);
    document.addEventListener("pointermove", handleDocumentPointerMove, true);
    document.addEventListener("selectionchange", scheduleSelectionUiUpdate);
    document.addEventListener("mouseup", scheduleSelectionUiUpdate, true);
    window.addEventListener("pointermove", handlePopupResizePointerMove, true);
    window.addEventListener("pointerup", handlePopupResizePointerEnd, true);
    window.addEventListener("pointercancel", handlePopupResizePointerEnd, true);
    window.addEventListener("scroll", hideSelectionTrigger, true);
    window.addEventListener("scroll", scheduleSandboxCardTriggerRender, true);
    document.addEventListener("wheel", handleDocumentWheel, { capture: true, passive: false });
    document.addEventListener("click", scheduleTopRightUiProtectionRefresh, true);
    document.addEventListener("pointerdown", handleDocumentPointerDown, true);
    document.addEventListener("focusin", handleDocumentFocusIn, true);
    window.addEventListener("message", handleFrameRelayMessage);
    window.setInterval(handleUrlChange, 900);
  }

  // ---- handleStorageChanged: Storage 동기화 ----
  function handleStorageChanged(changes, areaName) {
    if (areaName !== "local") {
      return;
    }

    const changedKeys = Object.keys(changes || {});
    if (!changedKeys.length) {
      return;
    }

    const currentUrlKey = normalizeUrlKey(state.currentUrlKey);
    const currentShardBucketKey = getBookmarkShardBucketStorageKey(currentUrlKey);
    const currentUiStateShardKey = getBookmarkUiStateShardStorageKey(currentUrlKey);
    const currentPopupLayoutShardKey = getPopupLayoutShardStorageKey(currentUrlKey);
    const changedPopupLayoutOnly = changedKeys.length > 0 && changedKeys.every(function (key) {
      return key === currentPopupLayoutShardKey;
    });
    if (changedPopupLayoutOnly && (Date.now() - state.popupLayoutReloadSuppressAt) < 800) {
      return;
    }

    const changedBookmarkUiStateOnly = changedKeys.length > 0 && changedKeys.every(function (key) {
      return key === currentUiStateShardKey;
    });
    if (changedBookmarkUiStateOnly && (Date.now() - state.bookmarkUiStateReloadSuppressAt) < 800) {
      return;
    }

    const changedCurrentShardBucket = Boolean(
      currentShardBucketKey &&
      Object.prototype.hasOwnProperty.call(changes, currentShardBucketKey)
    );
    const changedCurrentShardBucketPersistOnly = changedKeys.length > 0 && changedKeys.every(function (key) {
      return key === currentShardBucketKey || key === BOOKMARK_SHARD_INDEX_STORAGE_KEY;
    });
    if (
      changedCurrentShardBucket &&
      changedCurrentShardBucketPersistOnly &&
      (Date.now() - state.bookmarkBucketReloadSuppressAt) < 800
    ) {
      return;
    }

    if (Object.prototype.hasOwnProperty.call(changes, RAIL_OPACITY_STORAGE_KEY)) {
      state.railOpacity = normalizeRailOpacity(changes[RAIL_OPACITY_STORAGE_KEY].newValue);
      applyRailOpacity();
      syncBookmarkHistoryControlsToCurrentRail();
    }
    if (Object.prototype.hasOwnProperty.call(changes, RAIL_ENABLED_STORAGE_KEY)) {
      state.railEnabled = normalizeRailEnabled(changes[RAIL_ENABLED_STORAGE_KEY].newValue);
      applyRailOpacity();
      syncBookmarkHistoryControlsToCurrentRail();
      if (state.railEnabled) {
        scheduleSelectionUiUpdate();
      } else {
        hideSelectionTrigger();
        state.hoveredSandboxCardKey = "";
      }
      scheduleSandboxCardTriggerRender();
    }

    let shouldRenderRail = false;
    if (Object.prototype.hasOwnProperty.call(changes, BOOKMARK_SHARD_INDEX_STORAGE_KEY)) {
      state.bookmarkShardIndexByUrlHash = normalizeBookmarkShardIndexMap(changes[BOOKMARK_SHARD_INDEX_STORAGE_KEY].newValue);
    }

    if (currentPopupLayoutShardKey && Object.prototype.hasOwnProperty.call(changes, currentPopupLayoutShardKey)) {
      state.popupLayoutByBookmarkId = normalizePopupLayoutMap(changes[currentPopupLayoutShardKey].newValue);
      shouldRenderRail = true;
    }

    if (currentUiStateShardKey && Object.prototype.hasOwnProperty.call(changes, currentUiStateShardKey)) {
      state.bookmarkUiStateByUrl = buildSingleBookmarkUiStateObject(currentUrlKey, changes[currentUiStateShardKey].newValue);
      applyCurrentBookmarkUiState();
      shouldRenderRail = true;
    }

    if (changedCurrentShardBucket) {
      const nextBookmarks = normalizeBookmarkList(changes[currentShardBucketKey].newValue || [], currentUrlKey);
      state.bookmarksByUrl = currentUrlKey
        ? buildSingleBucketObject(currentUrlKey, nextBookmarks)
        : {};
      applyCurrentBookmarks();
      shouldRenderRail = true;
    }

    const changedLegacyUrlBucket = changedKeys.some(looksLikeUrl);
    const changedLegacyKnownKey = [PRIMARY_STORAGE_KEY, POPUP_LAYOUT_STORAGE_KEY, BOOKMARK_UI_STATE_STORAGE_KEY].concat(LEGACY_STORAGE_KEYS).some(function (key) {
      return Object.prototype.hasOwnProperty.call(changes, key);
    });

    if (shouldRenderRail) {
      renderBookmarks();
      return;
    }

    if (!changedLegacyKnownKey && !changedLegacyUrlBucket) {
      return;
    }

    if (hasBookmarkShardIndexEntry(state.bookmarkShardIndexByUrlHash, currentUrlKey)) {
      return;
    }

    loadBookmarks();
  }

  // ---- showUpdateBannerIfNeeded: 업데이트 배너 ----
  async function showUpdateBannerIfNeeded() {
    try {
      var raw = await storageGet([UPDATE_DISMISSED_STORAGE_KEY]);
      var dismissed = raw[UPDATE_DISMISSED_STORAGE_KEY] || "";
      if (dismissed === APP_VERSION) {
        return;
      }

      var notes = RELEASE_NOTES[APP_VERSION];
      if (!notes || !notes.length) {
        return;
      }

      var banner = document.createElement("div");
      banner.className = "cgptbm-update-banner";

      var title = document.createElement("div");
      title.className = "cgptbm-update-banner__title";
      title.textContent = "ChatMARK updated to v" + APP_VERSION;

      var list = document.createElement("ul");
      list.className = "cgptbm-update-banner__list";
      notes.forEach(function (note) {
        var item = document.createElement("li");
        item.textContent = note;
        list.appendChild(item);
      });

      var closeBtn = document.createElement("button");
      closeBtn.type = "button";
      closeBtn.className = "cgptbm-update-banner__close";
      closeBtn.textContent = "OK";
      closeBtn.addEventListener("click", function () {
        banner.remove();
        storageSet({ [UPDATE_DISMISSED_STORAGE_KEY]: APP_VERSION });
      });

      banner.appendChild(title);
      banner.appendChild(list);
      banner.appendChild(closeBtn);

      if (state.root) {
        state.root.appendChild(banner);
      }
    } catch (error) {
      logWarn("showUpdateBannerIfNeeded failed", error);
    }
  }

  // ---- handleUrlChange: SPA URL 변경 감지 ----
  function handleUrlChange() {
    if (window.location.href === state.lastHref) {
      return;
    }

    state.lastHref = window.location.href;
    state.currentUrlKey = getCurrentUrlKey();
    state.bookmarkSearchQuery = "";
    invalidateAllBulkBackups();
    clearActiveState();
    clearHighlightState();
    state.hoveredSandboxCardKey = "";
    finishHiddenScrollTransaction();
    endPopupResizeSession();
    resetExpandedBookmarkState();
    hideSelectionTrigger();
    closeSavePopup();
    resetAddTabFeedback();
    syncFrameRelayDebugState();
    loadBookmarks();
  }

  // ---- handleKeydown: 키보드 단축키 ----
  function handleKeydown(event) {
    if (event.key === "Escape") {
      if (state.popup) {
        closeSavePopup();
        return;
      }
      if (state.colorPicker) {
        closeBookmarkColorPicker();
        return;
      }
      if (
        state.bookmarkSearchQuery &&
        state.searchInput &&
        document.activeElement === state.searchInput
      ) {
        event.preventDefault();
        setBookmarkSearchQuery("");
        if (state.searchInput) {
          state.searchInput.focus();
        }
        return;
      }
    }

  }

  // ---- hasBookmarkShardIndexEntry: 인라인 헬퍼 ----
  function hasBookmarkShardIndexEntry(indexMap, urlKey) {
    const urlHash = getBookmarkShardUrlHash(urlKey);
    return Boolean(urlHash && indexMap && indexMap[urlHash]);
  }

})();
