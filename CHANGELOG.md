# Changelog

## v1.1.0

### Code Modularization
- Split `rail.js` (4,916 lines) into 12 focused submodules
  - `rail-controls.js` — UI controls (bookmark button, opacity slider)
  - `rail-dnd.js` — Drag and drop
  - `rail-interaction.js` — User interaction (click, hover, keyboard)
  - `rail-popup-dom.js` — Popup DOM creation
  - `rail-popup-geometry.js` — Popup positioning and sizing
  - `rail-popup-tab.js` — Popup tab rendering
  - `rail-render.js` — Render orchestration
  - `rail-render-layout.js` — Layout computation
  - `rail-render-state.js` — Render state management
  - `rail-render-tabs.js` — Tab DOM operations
  - `rail-search.js` — Bookmark search
  - `rail-tab-dom.js` — Tab element creation
  - `rail-viewport.js` — Viewport and scroll handling
- Extract `bookmarks-conversation.js` — conversation key helpers as standalone module

### Multi-platform Preparation
- Extend `capture.js` / `resolve.js` — internal scaffolding for future Claude and Gemini support (not yet active)

### Features
- Add bookmark export/import with backup dropdown UI
  - Save bookmarks to JSON file (with version and timestamp)
  - Restore bookmarks from file with key filtering and normalization
  - Warning: uninstalling without backup permanently deletes all bookmarks

### Security
- Apply CSS.escape() to all 9 querySelector calls with bookmark ID interpolation

### Bug Fixes
- Fix bookmark label reverting to old text after inline edit when performing search

### Stability
- Add bookmark site-ready guard — prevent bookmark operations before site is fully loaded

### No Breaking Changes
- No behavior changes, identical build output
- Fully compatible with existing stored data
