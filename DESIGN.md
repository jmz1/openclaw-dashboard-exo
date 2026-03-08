# EXO Dashboard — Design

> A modular agent operations dashboard for the EXO behavioural governance system.

## Architecture

```
https://your-host/exo/
        │
   nginx/proxy → 127.0.0.1:8768
        │
  ┌─────┴──────────────────────────────┐
  │  FastAPI (server/server.py)         │
  │                                     │
  │  GET /api/overview      (cached)    │
  │  GET /api/rules         (cached)    │
  │  GET /api/exo/stats     (cached)    │
  │  GET /api/exo/objections(cached)    │
  │  GET /api/remembrall/stats (cached) │
  │  GET /api/heartbeat     (cached)    │
  │  GET /api/self-review   (cached)    │
  │  GET /api/cron          (cached)    │
  │  GET /api/dashboard/config          │
  │  WS  /ws                (broadcast) │
  │                                     │
  │  + Provider-registered routes       │
  │                                     │
  │  File watchers:                     │
  │    config/exo/ → refresh_rules      │
  │    tmp/telemetry/ → refresh_exo     │
  │    heartbeat-state.json             │
  │    cron/jobs.json                   │
  │    + provider watch paths           │
  └─────────────────────────────────────┘
```

## Server-Side Providers

The server supports modular data providers in `server/providers/`. Each provider:

- Declares required config keys (auto-skipped if absent)
- Registers its own API routes
- Contributes to `/api/overview`
- Declares filesystem watch paths and periodic refresh intervals

See `server/providers/__init__.py` for the `Provider` protocol.

## Frontend Panel System

Panels are self-contained modules in `dashboard/panels/`:

- **Core panels** (`panels/core/`) — shipped with the repo
- **Custom panels** (`panels/custom/`) — gitignored, loaded dynamically by id

Panel order and visibility are configured via the server config YAML, exposed at `GET /api/dashboard/config`.

### Panel Interface

```js
{
  id,           // Unique identifier (kebab-case)
  label,        // Section title
  endpoints,    // API paths this panel consumes
  placement,    // 'main' (default) | 'rail'
  keyBindings,  // { key: description }

  init({ el, state, helpers, tooltip }),
  render({ el, state, helpers }),
  onKey(e),     // optional
}
```

## Design System

| Component | CSS Class | Used For |
|-----------|-----------|----------|
| Number strip | `.rm-nums > .rm-num` | Status counts |
| Two-column | `.events-two-col` | Feed + detail |
| Feed item | `.feed-item` | Row in a feed |
| Detail pane | `.detail-box` | Selected item info |
| Bar row | `.bar-row` | Completion bars |
| Block badge | `.bt-badge` | Tag/type badges |
| Placeholder | `.placeholder` | Empty state |

### Colour

- **oklch only** — all colour values use `oklch()`, CVD-safe (Krzywinski palette)
- CSS custom properties: `--t1`/`--t2`/`--t3` (text), `--bg-0`..`--bg-4` (surfaces), `--accent`, `--ok`, `--warn`, `--bad`, `--red`, `--det`, `--mem`
- Typography: Geist Sans / Geist Mono (`var(--mono)`)
