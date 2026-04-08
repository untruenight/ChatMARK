// ============================================================
// state.js — 앱 전체의 상태를 관리하는 중앙 저장소
// ============================================================
// 비유: "건물의 관제실 계기판". 모든 현재 상태를 한눈에 볼 수 있고,
//       변경은 이 파일을 통해서만 이루어져야 합니다.
//
// 향후 개선: getter/setter를 추가하여 상태 변경을 추적 가능하게 만들 수 있습니다.
//   예) setState('railEnabled', false) → 콘솔에 변경 로그 출력

import { DEFAULT_RAIL_OPACITY } from './constants.js';

const state = {
  // ---- Bookmark data ----
  bookmarksByUrl: {},
  bookmarkShardIndexByUrlHash: {},
  popupLayoutByBookmarkId: {},
  bookmarkUiStateByUrl: {},
  currentUrlKey: "",
  currentBookmarks: [],
  manualOrderBookmarkIds: [],
  bookmarkSearchQuery: "",

  // ---- DOM references ----
  root: null,
  railViewport: null,
  railScrollHitbox: null,
  railLayerViewport: null,
  railScrollSpacer: null,
  railScrollbar: null,
  railScrollbarTrack: null,
  railScrollbarThumb: null,
  railScrollbarDrag: null,
  searchInput: null,
  searchClearButton: null,
  searchStatus: null,
  layer: null,
  addTab: null,
  selectionTrigger: null,
  sandboxCardLayer: null,
  emptyTab: null,
  popup: null,
  popupForm: null,
  popupInput: null,
  scrollMask: null,
  scrollProgressFill: null,

  // ---- UI interaction state ----
  popupColorIndex: 0,
  colorPicker: null,
  colorPickerBookmarkId: "",
  colorPickerLockedBookmarkId: "",
  editLockedBookmarkId: "",
  pendingAnchor: null,
  pendingBookmarkId: "",
  lastHref: "",
  activeBookmarkId: "",
  hoveredBookmarkId: "",
  focusedBookmarkId: "",
  createPopupPreservedExpandedBookmarkId: "",
  pinnedBookmarkIds: [],
  expandedPinnedBookmarkIds: [],
  expandedPopupContentBookmarkIds: [],
  expandedBookmarkId: "",
  resizeLockedExpandedBookmarkId: "",
  popupResizeSession: null,
  resizeSettlingBookmarkId: "",

  // ---- Selection state ----
  selectionAnchor: null,
  selectionAnchorCachedAt: 0,
  selectionPopupPosition: null,
  selectionUiFrame: 0,
  pointerSelectionActive: false,

  // ---- Timers ----
  activeTimer: 0,
  highlightStartTimer: 0,
  highlightTimer: 0,
  postScrollTimer: 0,
  scrollMaskRevealTimer: 0,
  resizeSettleTimer: 0,
  addTabFeedbackTimer: 0,

  // ---- Scroll state ----
  hiddenScrollActive: false,
  scrollProgressValue: 0,
  highlightedElement: null,
  highlightedInlineNode: null,
  highlightedInlineNodes: [],

  // ---- Storage reload suppression (timestamp-based) ----
  // 비유: "내가 방금 보낸 편지는 무시" 표시. 타임스탬프로 800ms 이내 변경을 건너뜁니다.
  popupLayoutReloadSuppressAt: 0,
  bookmarkBucketReloadSuppressAt: 0,
  bookmarkUiStateReloadSuppressAt: 0,

  // ---- Undo/Redo ----
  bookmarkUndoStack: [],
  bookmarkRedoStack: [],

  // ---- Drag & drop ----
  bookmarkDragSession: null,
  bookmarkDragIndicator: null,
  bookmarkDragSuppressClickBookmarkId: "",
  bookmarkDragSuppressClickTimer: 0,
  bookmarkCreateInteractionGuardCount: 0,

  // ---- Rail display ----
  railOpacity: DEFAULT_RAIL_OPACITY,
  railEnabled: true,
  topRightUiObserver: null,
  topRightUiRefreshFrame: 0,

  // ---- 2-pass navigation ----
  navigateSessionId: 0,
  domStableObserver: null,

  // ---- Frame relay ----
  frameRelayDebugEnabled: false,

  // ---- Sandbox card ----
  hoveredSandboxCardKey: "",
  lastSandboxCardKey: "",
  lastSandboxCardInteractedAt: 0,
  sandboxCardHighlightPulseTimer: 0,
  sandboxCardRenderFrame: 0
};

export default state;
