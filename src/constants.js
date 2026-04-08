// ============================================================
// constants.js — 모든 상수값을 한 곳에서 관리
// ============================================================
// 비유: "설계 도면의 치수표". 수치를 바꾸고 싶으면 여기만 수정하면 됩니다.

export const ROOT_ID = "cgptbm-root";
export const PRIMARY_STORAGE_KEY = "bookmarksByUrl";
export const BOOKMARK_SHARD_INDEX_STORAGE_KEY = "bm:v2:index";
export const BOOKMARK_SHARD_BUCKET_PREFIX = "bm:v2:bucket:";
export const BOOKMARK_UI_STATE_SHARD_PREFIX = "bm:v2:ui:";
export const POPUP_LAYOUT_SHARD_PREFIX = "bm:v2:layout:";
export const POPUP_LAYOUT_STORAGE_KEY = "bookmarkPopupLayoutById";
export const BOOKMARK_UI_STATE_STORAGE_KEY = "bookmarkUiStateByUrl";
export const RAIL_OPACITY_STORAGE_KEY = "bookmarkRailOpacity";
export const RAIL_ENABLED_STORAGE_KEY = "bookmarkRailEnabled";
export const POPUP_LIST_MARKER_ATTR = "data-cgptbm-popup-marker";
export const POPUP_LIST_LEAD_MARKER_ATTR = "data-cgptbm-popup-lead-marker";
export const LEGACY_STORAGE_KEYS = ["chatgptBookmarksByUrl", "bookmarks"];

// ---- 도메인 별칭 (도메인 변경 시 기존 저장소 키 호환 유지) ----
export const ORIGIN_ALIASES = {
  "https://chat.openai.com": "https://chatgpt.com",
};
export const HIGHLIGHT_CLASS = "cgptbm-target-highlight";
export const SELECTION_TRIGGER_LABEL = "MARK";
// ---- i18n ----
var _uiLang = (typeof navigator !== "undefined" && navigator.language || "en").slice(0, 2);

export function msg(key) {
  var table = UI_MESSAGES[_uiLang] || UI_MESSAGES.en;
  return table[key] !== undefined ? table[key] : (UI_MESSAGES.en[key] || key);
}

export const UI_MESSAGES = {
  en: {
    unnamed: "Unnamed",
    addBookmark: "Add bookmark",
    saved: "Saved",
    dragToSelect: "Drag to select text",
    searchTab: "Search Tab",
    searchTabs: "Search Tabs",
    scrollRail: "Scroll bookmark rail",
    clearSearch: "Clear bookmark search",
    searchPlaceholder: "Search current page bookmarks",
    saveToFile: "Save bookmarks to file",
    restoreFromFile: "Restore bookmarks from file",
    uninstallWarning: "\u26A0 Uninstalling ChatMARK without backup will permanently delete all bookmarks.",
    undoBookmark: "Undo bookmark add or remove",
    redoBookmark: "Redo bookmark add or remove",
    saveOrRestore: "Save or restore bookmarks",
    disableRail: "Disable bookmark rail",
    enableRail: "Enable bookmark rail",
    adjustOpacity: "Adjust bookmark rail opacity",
    collapseAll: "Collapse all bookmarks",
    extendTabs: "Extend all tabs",
    extendPostits: "Extend all post-its",
    selectColor: "Select bookmark color",
    hideColors: "Hide bookmark colors",
    showColors: "Show bookmark colors",
    bookmarkName: "Bookmark name",
    save: "Save",
    colorPicker: "Bookmark color picker",
    bookmarkLabel: "Bookmark",
    maximize: "Maximize note",
    maxLabel: "max",
    collapse: "Collapse note",
    minLabel: "min",
    markWidget: "Mark Claude widget card",
    bannerThanks: "Thanks for having ",
    bannerUpdated: "ChatMARK updated to v",
    bannerPatchlog: " Patchlog",
    bannerOk: "OK",
    bannerCredit: "ChatMARK by untruenight",
    onboardingTitle: "How to use ChatMARK",
    onboardingStep1: "Drag to select any text in the conversation",
    onboardingStep2: "Tap the MARK button that appears",
    onboardingStep3: "Your bookmark is saved to the rail",
    onboardingClose: "Got it",
    noMatches: "No matches",
    addBookmarkHint: "Add a bookmark from your current selection or visible message.",
    noMatchesDetail_one: "1 bookmark is still saved on this page.",
    noMatchesDetail_other: " bookmarks are still saved on this page.",
    noMatchesPrefix: "No bookmarks on this page match \""
  },
  ko: {
    unnamed: "이름 없음",
    addBookmark: "북마크 추가",
    saved: "저장됨",
    dragToSelect: "텍스트를 드래그하세요",
    searchTab: "탭 검색",
    searchTabs: "탭 검색",
    scrollRail: "북마크 레일 스크롤",
    clearSearch: "북마크 검색 지우기",
    searchPlaceholder: "현재 페이지 북마크 검색",
    saveToFile: "북마크를 파일로 저장",
    restoreFromFile: "파일에서 북마크 복원",
    uninstallWarning: "\u26A0 백업 없이 ChatMARK를 삭제하면 모든 북마크가 영구 삭제됩니다.",
    undoBookmark: "북마크 추가/삭제 되돌리기",
    redoBookmark: "북마크 추가/삭제 다시 실행",
    saveOrRestore: "북마크 저장 또는 복원",
    disableRail: "북마크 레일 비활성화",
    enableRail: "북마크 레일 활성화",
    adjustOpacity: "북마크 레일 투명도 조절",
    collapseAll: "모든 북마크 접기",
    extendTabs: "모든 탭 펼치기",
    extendPostits: "모든 포스트잇 펼치기",
    selectColor: "북마크 색상 선택",
    hideColors: "북마크 색상 숨기기",
    showColors: "북마크 색상 보기",
    bookmarkName: "북마크 이름",
    save: "저장",
    colorPicker: "북마크 색상 선택기",
    bookmarkLabel: "북마크",
    maximize: "노트 최대화",
    maxLabel: "max",
    collapse: "노트 접기",
    minLabel: "min",
    markWidget: "Claude 위젯 카드 마크",
    bannerThanks: "ChatMARK를 설치해 주셔서 감사합니다",
    bannerUpdated: "ChatMARK가 v",
    bannerUpdatedSuffix: "로 업데이트되었습니다",
    bannerPatchlog: " 패치 노트",
    bannerOk: "확인",
    bannerCredit: "ChatMARK by untruenight",
    onboardingTitle: "ChatMARK 사용법",
    onboardingStep1: "대화에서 원하는 텍스트를 드래그하세요",
    onboardingStep2: "표시되는 MARK 버튼을 누르세요",
    onboardingStep3: "북마크가 우측 세로 선에 저장됩니다",
    onboardingClose: "확인",
    noMatches: "일치 항목 없음",
    addBookmarkHint: "현재 선택 영역 또는 표시된 메시지에서 북마크를 추가하세요.",
    noMatchesDetail_one: "이 페이지에 북마크 1개가 저장되어 있습니다.",
    noMatchesDetail_other: "개의 북마크가 이 페이지에 저장되어 있습니다.",
    noMatchesPrefix: "이 페이지에서 \""
  }
};

export const RELEASE_NOTES_I18N = {
  "1.2.0-beta": {
    en: [
      "Gemini (gemini.google.com) support",
      "Korean/English language support",
      "Improved UI design and new user guide"
    ],
    ko: [
      "Gemini (gemini.google.com) 지원",
      "한국어/영어 자동 언어 지원",
      "UI 디자인 개선 및 사용 안내 추가"
    ]
  },
  "1.1.0": {
    en: [
      "Bookmark export/import (save & restore from file)",
      "Internal code modularization for maintainability",
      "Preparing multi-platform support (coming soon)",
      "Improved site-ready stability guard",
      "Security hardening for CSS selector injection"
    ],
    ko: [
      "북마크 내보내기/가져오기 (파일로 저장 및 복원)",
      "유지보수를 위한 내부 코드 모듈화",
      "멀티 플랫폼 지원 준비 (곧 출시)",
      "사이트 준비 상태 안정성 강화",
      "CSS 셀렉터 인젝션 보안 강화"
    ]
  },
  "1.0.0": {
    en: [
      "First official release",
      "Bookmark any text in ChatGPT conversations",
      "Color-coded tabs on right-side rail",
      "Drag-and-drop reorder, pin, and expand",
      "Current-page bookmark search",
      "Undo/redo support"
    ],
    ko: [
      "첫 정식 출시",
      "ChatGPT 대화에서 텍스트 북마크",
      "우측 레일에 색상별 탭",
      "드래그 앤 드롭 정렬, 고정, 확장",
      "현재 페이지 북마크 검색",
      "되돌리기/다시 실행 지원"
    ]
  }
};

export function getReleaseNotes(version) {
  var entry = RELEASE_NOTES_I18N[version];
  if (!entry) return null;
  return entry[_uiLang] || entry.en || null;
}

export const DEFAULT_BOOKMARK_LABEL = "Unnamed";
export const ADD_TAB_DEFAULT_LABEL = "Add bookmark";
export const ADD_TAB_SUCCESS_LABEL = "Saved";

export const BLOCK_SELECTOR = "p, li, pre, blockquote, h1, h2, h3, h4, h5, h6";
export const MESSAGE_SELECTOR = [
  "[data-message-author-role]",
  "[data-author-role]",
  "[data-role='user']",
  "[data-role='assistant']",
  "[data-testid*='conversation-turn']",
  "[data-testid*='chat-turn']",
  "[data-testid*='turn']",
  "[data-testid*='message']",
  "[data-testid*='prompt']",
  "[data-testid*='response']",
  "[role='article']",
  "[role='listitem']",
  "article"
].join(", ");

export const TAB_COLORS = [
  "#ff7f50", "#1e90ff", "#32cd32", "#ff4d4f", "#a855f7",
  "#ffd43b", "#00c2a8", "#ff66c4", "#6c63ff", "#b9e769"
];

export const DEFAULT_SCOPE_ROOT_SELECTORS = ["main", "[role='main']"];

export const SITE_PROFILES = [
  {
    id: "openai",
    hosts: ["chatgpt.com", "chat.openai.com"],
    scopeSelectors: ["main", "[role='main']"],
    conversationPathTokens: ["c", "chat", "conversation", "conversations", "codex"],
    conversationQueryKeys: ["conversationId", "conversation_id", "chatId", "chat_id", "threadId", "thread_id", "c"],
    messageIdAttr: "data-message-id",
    userTextSelector: "",
    // ---- profile-aware DOM contract ----
    messageSelector: "[data-message-author-role], [data-testid*='conversation-turn']",
    roleAttrs: ["data-message-author-role", "data-author-role", "data-role"],
    assistantMarkers: ["assistant", "chatgpt", "codex"]
  },
  {
    id: "claude",
    hosts: ["claude.ai"],
    scopeSelectors: ["main", "[role='main']"],
    conversationPathTokens: ["chat", "conversation", "conversations", "project"],
    conversationQueryKeys: ["conversationId", "conversation_id", "chatId", "chat_id", "threadId", "thread_id", "c"],
    messageIdAttr: "",
    userTextSelector: "p, div[class*='user'], div[class*='human']",
    // ---- profile-aware DOM contract ----
    messageSelector: "[data-testid='user-message'], [data-testid='assistant-message'], [data-testid*='chat-turn'], [data-is-streaming], div[class*='font-claude-message'], div[class*='font-user-message']",
    roleAttrs: ["data-testid", "data-role"],
    assistantMarkers: ["assistant", "claude", "model"]
  },
  {
    id: "gemini",
    hosts: ["gemini.google.com"],
    scopeSelectors: ["main", "[role='main']"],
    conversationPathTokens: ["app", "chat", "conversation", "conversations"],
    conversationQueryKeys: ["conversationId", "conversation_id", "chatId", "chat_id", "threadId", "thread_id", "c"],
    messageIdAttr: "",
    userTextSelector: "p, div[data-text-content], div[class*='query']",
    // ---- profile-aware DOM contract ----
    messageSelector: "message-content, .conversation-container > [data-turn-id], [data-message-id], div[class*='query-content'], div[class*='response-container'], div[class*='model-response']",
    roleAttrs: ["data-author-role", "data-role"],
    assistantMarkers: ["assistant", "gemini", "model", "response"],
    viewportDefaultTop: 120,
    historyControlsTop: 120,
    rootRightOffset: 68
  }
];

export const ALLOWED_FRAME_ORIGINS = [
  "https://chatgpt.com",
  "https://chat.openai.com"
  // Claude/Gemini 지원 재개 시 복원:
  // "https://claude.ai",
  // "https://gemini.google.com",
  // "https://www.claudeusercontent.com",
  // "https://www.claudemcpcontent.com"
];

// ---- Layout dimensions (px) ----
export const POST_SCROLL_TARGET_TOP_OFFSET = 168;
export const HIGHLIGHT_EXTRA_TOP_MARGIN = 0;
export const POST_SCROLL_CONTAINER_PADDING = 80;
export const COLLAPSED_TAB_HEIGHT = 40;
export const EXPANDED_TAB_SURFACE_HEIGHT = 40; // Unified with COLLAPSED_TAB_HEIGHT; kept for future configurability
export const COLLAPSED_TAB_VISIBLE_EDGE_WIDTH = 18;
export const ROOT_RIGHT_OFFSET = 78;
export const RAIL_VIEWPORT_DEFAULT_TOP = 109;
export const RAIL_VIEWPORT_WIDTH = 192;
export const RAIL_LAYER_LEFT_BLEED = 180;
export const RAIL_LAYER_RIGHT_BLEED = 34;
export const TAB_STACK_GAP = 4;
export const TAB_POPUP_OFFSET = 4;

// ---- Popup dimensions (px) ----
export const POPUP_MIN_WIDTH = 142;
export const POPUP_MAX_WIDTH = 420;
export const POPUP_MIN_HEIGHT = 64;
export const POPUP_MAX_HEIGHT = 420;

// ---- Selection UI dimensions (px) ----
export const SELECTION_TRIGGER_WIDTH = 56;
export const SELECTION_TRIGGER_HEIGHT = 20;
export const SELECTION_POPUP_WIDTH = 136;
export const SELECTION_POPUP_HEIGHT = 56;
export const SELECTION_UI_GAP = 8;
export const SELECTION_UI_VIEWPORT_GAP = 8;
export const SELECTION_UI_BLOCKER_SAFE_GAP = 6;
export const SELECTION_UI_BLOCKER_NEARBY_VERTICAL_GAP = 160;
export const SELECTION_UI_BLOCKER_NEARBY_HORIZONTAL_GAP = 220;
export const SELECTION_UI_BLOCKER_MIN_WIDTH = 24;
export const SELECTION_UI_BLOCKER_MIN_HEIGHT = 20;
export const SELECTION_UI_BLOCKER_SELECTOR = [
  "button",
  "[role='button']",
  "[role='dialog']",
  "[role='menu']",
  "[role='listbox']",
  "[data-radix-popper-content-wrapper]",
  "[data-radix-dropdown-menu-content]",
  "[data-radix-popover-content]",
  "[aria-live='polite'].fixed"
].join(", ");

// ---- Limits ----
export const MAX_CAPTURED_SELECTION_LENGTH = 4000;
export const MAX_CAPTURED_SELECTION_RAW_LENGTH = 4000;
export const BOOKMARK_HISTORY_LIMIT = 10;
export const MAX_BOOKMARKS_PER_PAGE = 10;
export const DEFAULT_RAIL_OPACITY = 0.8;
export const MIN_RAIL_OPACITY = 0.1;
export const MAX_RAIL_OPACITY = 1;

// ---- URL / Conversation ID ----
export const DEFAULT_CONVERSATION_PATH_TOKENS = ["c", "chat", "chats", "conversation", "conversations", "thread", "threads", "app", "codex"];
export const DEFAULT_CONVERSATION_QUERY_KEYS = ["conversationId", "conversation_id", "chatId", "chat_id", "threadId", "thread_id", "sessionId", "session_id", "c"];
export const RESERVED_CONVERSATION_SEGMENTS = [
  "new",
  "new-chat",
  "home",
  "settings",
  "recents",
  "recent",
  "history",
  "library",
  "explore",
  "discover",
  "projects",
  "project",
  "gems",
  "gem",
  "account",
  "help",
  "login",
  "auth",
  "oauth",
  "share"
];

// ---- Frame relay message types ----
export const FRAME_RELAY_SELECTION_MESSAGE_TYPE = "cgptbm-frame-selection";
export const FRAME_RELAY_CLEAR_MESSAGE_TYPE = "cgptbm-frame-selection-clear";
export const FRAME_RELAY_REVEAL_MESSAGE_TYPE = "cgptbm-frame-bookmark-reveal";
export const FRAME_RELAY_DEBUG_MESSAGE_TYPE = "cgptbm-frame-debug-state";

// ---- Sandbox card ----
export const SANDBOX_CARD_TRIGGER_WIDTH = 64;
export const SANDBOX_CARD_TRIGGER_HEIGHT = 28;
export const SANDBOX_CARD_TRIGGER_HOVER_BRIDGE = 12;
export const SANDBOX_CARD_HIGHLIGHT_FADE_IN_DURATION = 400;
export const SANDBOX_CARD_HIGHLIGHT_HOLD_DURATION = 500;
export const SANDBOX_CARD_HIGHLIGHT_FADE_OUT_DURATION = 500;
export const SANDBOX_CARD_HIGHLIGHT_EXIT_FADE_OUT_DURATION = 200;

// ---- Frame relay debug ----
export const FRAME_RELAY_DEBUG_QUERY_PARAM = "cgptbmFrameDebug";
export const FRAME_RELAY_DEBUG_STORAGE_KEY = "cgptbm:debug:frame-relay";

// ---- Update banner ----
export const APP_VERSION = "1.2.0-beta";
export const UPDATE_DISMISSED_STORAGE_KEY = "cgptbm:update:dismissed";
export const ONBOARDING_DISMISSED_STORAGE_KEY = "cgptbm:onboarding:dismissed";
