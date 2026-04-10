# Findings

## Codebase Analysis — 2026-04-10

### Tech Stack
- **Frontend**: Vue 3.5.30 + Pinia 3 + Vue Router 4 + Element Plus 2.11 + TypeScript 5.9
- **Backend**: Fastify 5.6 + Prisma 6.7 + TypeScript
- **Build**: Vite 8 with manual chunk splitting

### Already Implemented
- `app.config.errorHandler` in main.ts (line 22) — logs to console only
- API error interceptor in api.ts — shows ElMessage for network/auth/server errors
- Network store (stores/network.ts) — online/offline detection
- OfflineBanner.vue — shows banner when offline
- Service Worker (public/sw.js) — cache-first static, network-first API
- Web App Manifest (public/manifest.json) — PWA config
- Request logging middleware in server (index.ts line 50) — logs method, URL, status, duration
- Graceful shutdown handling

### AdminView Section Map
- `dashboard`: line 1984–2180 (~196 lines template)
- `activities`: line 2181–2252 (~71 lines)
- `groups`: line 2253–2331 (~78 lines)
- `students`: line 2332–2387 (~55 lines)
- `judges`: line 2388–2443 (~55 lines)
- `roles`: line 2444–2500 (~56 lines)
- `templates`: line 2501–2678 (~177 lines)
- `results`: line 2679–2831 (~152 lines)
- `logs`: line 2832–end

### JudgeView Section Map
- `home`: line 879–973
- `students`: line 974–1081
- `score`: line 1082–1282 (largest section)
- `voting`: line 1283–1320
- `profile`: line 1321–1334
- `announcement`: line 1335–end

### Component Dependencies
- AdminView imports: AppShell, DocViewer (async), ImportDialog (async), RichEditor (async)
- JudgeView imports: AppShell, DocViewer (async), ScoreDialog (async)
- Both use `useModalHistory` composable for back-button support

### Key Patterns
- Section-based rendering via `v-if="section === 'X'"` — easy to extract
- Shared state held in top-level refs — needs composable extraction
- `defineAsyncComponent` for heavy components — good for code splitting
