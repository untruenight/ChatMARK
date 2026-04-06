# Performance Notes — v1.1.0-beta (2026-04-07)

## Bottleneck Analysis: 5+ Tabs Jank on Create/Delete/Undo/Redo

### Root Cause (Priority Order)

1. **Full DOM Destruction/Recreation** (Primary)
   - `renderBookmarks()` at `rail-render.js:464-521`
   - Removes ALL tab DOM nodes, recreates from scratch
   - 5 tabs = 280-300 DOM mutations per operation
   - Applies to: create, delete, undo, redo (full render path)

2. **Class Toggle → Forced Reflow** (Secondary)
   - `_syncRenderedBookmarkInteractionVisuals()` at `rail-render-state.js:138-143`
   - Toggles 6 classes per tab (`is-expanded`, `is-active`, etc.) before measurement
   - Subsequent `scrollHeight` reads force synchronous reflow

3. **Per-Tab scrollHeight/offsetHeight Reads** (Contributing)
   - `measureRenderedTabLayout()` at `rail-render-layout.js:288, 321-328`
   - Each expanded tab reads 3-4 layout properties
   - `getComputedStyle()` at line 325 adds per-action reflow (defensive check, keep as-is)

### Evaluated and Rejected Optimizations

| Proposal | Verdict | Reason |
|----------|---------|--------|
| Measurement cache (`state.tabLayoutMeasurementCache`) | Rejected | CSS variable / expansion state mismatch, cache invalidation complexity |
| Remove `normalizeBookmarkList` in `persistBookmarks()` | Rejected | Safety gate for history undo cross-URL writes |
| Parallelize persist in `handleBookmarkRemove()` | Rejected | Max 15ms gain, error handling loss |
| Read-write phase separation in `syncRenderedBookmarkRail()` | Rejected | CSS variable writes are deferred by browser; ~5-15% gain, not ~60% |
| `getComputedStyle` → `classList` replacement | Rejected | Defensive check worth keeping for future CSS changes |
| scrollHeight batch within `measureRenderedTabLayout` | Rejected | No DOM writes between reads; browser already batches |

### Recommended Future Optimizations

#### A. Incremental DOM Update (High Impact, Medium Effort)
- Replace full DOM teardown/rebuild with diff-based update
- Reuse existing tab elements, only update changed properties
- Location: `rail-render.js:464-521`
- Expected: ~70% reduction in DOM mutations

#### B. Viewport Windowing (High Impact, High Effort)
- Only render tabs within visible viewport + buffer
- Collapsed off-screen tabs use estimated height (COLLAPSED_TAB_HEIGHT)
- Expanded tabs always rendered
- Location: `rail-render.js:515-521`, `rail-render.js:595-604`
- Expected: 3-7x reduction in DOM nodes for 10+ tabs

#### C. requestAnimationFrame Debouncing for Hover (Medium Impact, Low Effort)
- Coalesce rapid hover events into single frame
- Location: `rail-render-state.js` → `syncRenderedBookmarkRail` calls
- Expected: ~70% reduction in hover-triggered reflows
- Note: Only affects hover, not create/delete/undo/redo
