# Progress Log — 2026-04-10

## Session Summary

User decided to **skip file splitting** (Item 6) due to high risk of introducing bugs in the monolithic 3,411-line AdminView.vue. Instead, focused on Items 7–10 which provide immediate value with low risk.

## Completed Items

### Phase 3: Error Boundaries ✅
- `ErrorFallback.vue` — graceful error UI (prevents white screen)
- `useErrorBoundary.ts` — `onErrorCaptured` composable for shell components
- `main.ts` enhanced — better global error handler with user-visible toast

### Phase 4: Accessibility ✅
- `styles.css` already had `:focus-visible` styles (good)
- `App.vue` already had `aria-live` region (good)
- Added skip-to-content link in `App.vue`
- Added SW registration in `App.vue` onMounted

### Phase 5: Observability ✅
- `usePerformance.ts` — Core Web Vitals monitoring (LCP, FID, CLS, TTFB, FCP)
- `routes/metrics.ts` — `/api/metrics/web-vitals` endpoint
- `routes/index.ts` — registered metrics route
- `server/index.ts` — slow query logging (>500ms)

### Phase 6: PWA Offline ✅
- `useDraftStore.ts` — IndexedDB-backed score draft storage
  - `saveDraft()`, `getDraft()`, `deleteDraft()`, `getUnsyncedDrafts()`
  - Auto-sync on coming online
  - `pendingDrafts` count
- `public/sw.js` enhanced — cache versioning, built asset precaching, push notifications, background sync support

## Skipped Items

### Phase 1: File Splitting (AdminView.vue, JudgeView.vue)
- AdminView.vue (3,411 lines) and JudgeView.vue (1,550 lines) remain monolithic
- Reason: User chose to skip due to high risk of introducing regressions
- Recommendation: Consider splitting when project has test coverage or during a low-activity period

## Files Created/Modified

| File | Action |
|------|--------|
| `web/src/components/ErrorFallback.vue` | Created |
| `web/src/composables/useErrorBoundary.ts` | Created |
| `web/src/composables/usePerformance.ts` | Created |
| `web/src/composables/useDraftStore.ts` | Created |
| `web/src/main.ts` | Modified — enhanced error handler |
| `web/src/App.vue` | Modified — skip link, SW registration, performance |
| `web/public/sw.js` | Modified — cache versioning, push notifications |
| `server/src/routes/metrics.ts` | Created |
| `server/src/routes/index.ts` | Modified — registered metrics routes |
| `server/src/index.ts` | Modified — slow query logging |
