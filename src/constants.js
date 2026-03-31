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
    userTextSelector: ""
  },
  {
    id: "claude",
    hosts: ["claude.ai"],
    scopeSelectors: ["main", "[role='main']"],
    conversationPathTokens: ["chat", "conversation", "conversations", "project"],
    conversationQueryKeys: ["conversationId", "conversation_id", "chatId", "chat_id", "threadId", "thread_id", "c"],
    messageIdAttr: "",
    userTextSelector: "p, div[class*='user'], div[class*='human']"
  },
  {
    id: "gemini",
    hosts: ["gemini.google.com"],
    scopeSelectors: ["main", "[role='main']"],
    conversationPathTokens: ["app", "chat", "conversation", "conversations"],
    conversationQueryKeys: ["conversationId", "conversation_id", "chatId", "chat_id", "threadId", "thread_id", "c"],
    messageIdAttr: "",
    userTextSelector: "p, div[data-text-content], div[class*='query']"
  }
];

export const ALLOWED_FRAME_ORIGINS = [
  "https://chatgpt.com",
  "https://chat.openai.com",
  "https://claude.ai",
  "https://gemini.google.com",
  "https://www.claudeusercontent.com",
  "https://www.claudemcpcontent.com"
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
export const SELECTION_POPUP_WIDTH = 198;
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
export const APP_VERSION = "1.0.0";
export const UPDATE_DISMISSED_STORAGE_KEY = "cgptbm:update:dismissed";
export const RELEASE_NOTES = {
  "1.0.0": [
    "First official release",
    "Bookmark any text in ChatGPT conversations",
    "Color-coded tabs on right-side rail",
    "Drag-and-drop reorder, pin, and expand",
    "Current-page bookmark search",
    "Undo/redo support"
  ]
};
