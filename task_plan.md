---
name: Improvements 6-10 Plan
description: Implementation plan for file splitting, error boundaries, accessibility, observability, and PWA offline support
created: 2026-04-10
---

# Improvement Plan: Items 6-10

## Goal
Improve maintainability, resilience, accessibility, observability, and offline capability of the scoring system.

## Current State Assessment

| Item | Status | Notes |
|------|--------|-------|
| 6. File splitting | **Not started** | AdminView 3,411 lines, JudgeView 1,550 lines, styles.css 2,434 lines |
| 7. Error boundaries | **Partially done** | `app.config.errorHandler` exists in main.ts but no `onErrorCaptured` in views |
| 8. Accessibility | **Not started** | No aria-labels, no focus management, no aria-live |
| 9. Observability | **Partially done** | Server has request logging, but no APM/Sentry/frontend monitoring |
| 10. PWA offline | **Partially done** | Has sw.js, manifest.json, network store, OfflineBanner — but no IndexedDB draft saving |

---

## Phase 1: AdminView Splitting (Item 6 — highest impact)

### 1.1 Create admin sub-components
Split AdminView.vue's 9 section templates into separate components:

| Section | Component | Template Lines |
|---------|-----------|---------------|
| dashboard | `AdminDashboard.vue` | 1984–2180 |
| activities | `AdminActivities.vue` | 2181–2252 |
| groups | `AdminGroups.vue` | 2253–2331 |
| students | `AdminStudents.vue` | 2332–2387 |
| judges | `AdminJudges.vue` | 2388–2443 |
| roles | `AdminRoles.vue` | 2444–2500 |
| templates | `AdminTemplates.vue` | 2501–2678 |
| results | `AdminResults.vue` | 2679–2831 |
| logs | `AdminLogs.vue` | 2832–end |

### 1.2 Shared state management
- Create a composable `useAdminState.ts` to hold shared reactive state (activities, groups, students, judges, templates, logs, customRoles, etc.)
- Each sub-component receives needed state via props or uses the shared composable
- AdminView becomes a thin shell that renders `<component :is="currentSection" />`

### 1.3 Styles migration
- Move AdminView-specific styles from `styles.css` into `<style scoped>` in each sub-component
- Keep truly global styles (Element Plus overrides, reset styles) in `styles.css`

## Phase 2: JudgeView Splitting (Item 6)

### 2.1 Create judge sub-components
Split JudgeView.vue's 6 section templates:

| Section | Component | Template Lines |
|---------|-----------|---------------|
| home | `JudgeHome.vue` | 879–973 |
| students | `JudgeStudents.vue` | 974–1081 |
| score | `JudgeScore.vue` | 1082–1282 |
| voting | `JudgeVoting.vue` | 1283–1320 |
| profile | `JudgeProfile.vue` | 1321–1334 |
| announcement | `JudgeAnnouncement.vue` | 1335–end |

### 2.2 Shared state
- Create `useJudgeState.ts` composable for shared state
- JudgeView becomes thin shell

## Phase 3: Error Boundaries (Item 7)

### 3.1 Enhance global error handler
- Current `app.config.errorHandler` only logs to console
- Add user-visible notification (ElMessage) for uncaught errors
- Distinguish between recoverable (show toast) and fatal (show error page)

### 3.2 Add `onErrorCaptured` in shell components
- Wrap `<component :is="section" />` in AppShell with error boundary
- Show fallback UI instead of white screen when a section crashes
- Add `ErrorFallback.vue` component

## Phase 4: Accessibility (Item 8)

### 4.1 Keyboard navigation
- Add focus-visible styles to all interactive elements
- Ensure tab order is logical in scoring forms
- Add skip-to-content link

### 4.2 ARIA attributes
- Add `aria-label` to all icon-only buttons (edit, delete, download, etc.)
- Add `aria-live="polite"` region for score submission feedback
- Add `role="status"` for loading indicators
- Ensure dialog/modal focus trapping works (Element Plus handles most)

### 4.3 Color contrast
- Audit text-on-glass colors, ensure WCAG AA (4.5:1)
- Fix any low-contrast text in scoring UI

## Phase 5: Observability (Item 9)

### 5.1 Server-side enhancements
- Add slow query warning (>500ms) to existing request logger
- Add structured error logging with stack traces

### 5.2 Frontend monitoring
- Create lightweight `usePerformance` composable
- Report Core Web Vitals (LCP, FID, CLS) to server via beacon API
- Add `/api/metrics` endpoint to receive frontend metrics
- No external services — keep it self-hosted

## Phase 6: PWA Offline Enhancement (Item 10)

### 6.1 Enhanced Service Worker
- Current sw.js only caches `/` and `/manifest.json`
- Add precache of built JS/CSS bundles (via Vite plugin or manifest)
- Add offline fallback page

### 6.2 IndexedDB score drafts
- Create `useDraftStore` with IndexedDB backend
- Auto-save scoring drafts locally when connectivity drops
- Sync drafts back to server when online
- Show draft indicator in UI

---

## Execution Priority
1. **Phase 1** (AdminView split) — biggest maintenance win
2. **Phase 2** (JudgeView split) — same pattern, follow Phase 1
3. **Phase 3** (Error boundaries) — small scope, high resilience
4. **Phase 6** (PWA offline) — critical for field use
5. **Phase 4** (Accessibility) — important but many small changes
6. **Phase 5** (Observability) — nice-to-have, can iterate

## Errors Encountered
| Error | Attempt | Resolution |
|-------|---------|------------|
| (none yet) | | |
