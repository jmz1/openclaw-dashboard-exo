# EXO Dashboard

A companion dashboard for the [EXO](https://github.com/jmz1/openclaw-ext-exo) behavioural governance extension. Visualises rule structure, firing statistics, event history, and related agent systems in a single-page dashboard.

<!-- TODO: Add screenshot -->
<!-- ![Dashboard screenshot](docs/screenshot.png) -->

## Features

**Core panels** (enabled by default):

| Panel | Description |
|-------|-------------|
| **EXO Statistics** | 2×2 grid of deny/gate/detent/objection activity with bar charts |
| **Recent Events** | Filterable event feed with detail pane — blocks, passes, detections, objections |
| **Rule Graph** | D3 flow chart for every rule: tool → params → conditions → match values, with detector bypass paths |
| **Scheduled Processes** | Cron job status, schedules, run history, meta-process badges |
| **Heartbeat** | Last heartbeat check timestamps with freshness colouring |
| **Remembrall** | Activation history, write destinations, pattern frequency bars |
| **Metrics Rail** | Bottom summary strip aggregating key numbers across all systems |

Custom panels can be added in `dashboard/panels/custom/` with optional server-side providers in `server/providers/`. See [Custom Panels](#custom-panels) below.

## Architecture

```
Browser → nginx/reverse proxy → Python server (FastAPI)
                                      │
                                ┌─────┴─────────────┐
                                │  File watchers     │
                                │  on rules, toollog,│
                                │  telemetry, etc.   │
                                └────────────────────┘
                                      │
                                ┌─────┴─────────────┐
                                │  WebSocket push    │
                                │  on data changes   │
                                └────────────────────┘
```

The server reads EXO rules, toollog JSONL, telemetry, and other workspace files. Data is cached in memory and refreshed via filesystem watchers. Changes are pushed to connected dashboards over WebSocket.

The dashboard is a modular single-page app. Each section is a self-contained panel module (`panels/<name>/panel.js`). Panel order and visibility are configured via the server — no need to edit dashboard code.

## Requirements

- Python 3.12+
- [OpenClaw](https://github.com/openclaw/openclaw) with the [EXO extension](https://github.com/jmz1/openclaw-ext-exo)
- Dependencies: `fastapi`, `uvicorn`, `pyyaml`, `watchfiles`


## Setup

### 1. Clone the repo

```bash
git clone https://github.com/jmz1/openclaw-dashboard-exo.git
cd openclaw-dashboard-exo
```

### 2. Install dependencies

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install .
```

Or with [uv](https://docs.astral.sh/uv/):

```bash
uv venv
uv pip install .
```

### 3. Configure the server

Copy the example config to your workspace (keep it outside the repo so updates don't overwrite your settings):

```bash
mkdir -p /path/to/workspace/config/infra
cp server/config.example.yaml /path/to/workspace/config/infra/exo-dashboard.yaml
```

Edit the config — update all paths to match your workspace:

```yaml
port: 8768

# Optional — enables workspace-relative path display
workspace: /path/to/workspace

paths:
  rules: /path/to/workspace/config/exo
  self_review: /path/to/workspace/memory/self-review.md
  telemetry_dir: /path/to/workspace/tmp/telemetry
  heartbeat_state: /path/to/workspace/tmp/heartbeat-state.json
  cron_jobs: /path/to/.openclaw/cron/jobs.json
```

### 4. Customise the dashboard (optional)

Add a `dashboard` section to your config to control which panels appear and in what order:

```yaml
dashboard:
  panels:
    - id: exo-stats
    - id: events
    - id: rule-graph
    - id: cron
    - id: heartbeat
    - id: remembrall
    - id: metrics-rail
    # Custom panels load from panels/custom/<id>/panel.js
```

If this section is omitted, the dashboard shows all core panels in the default order.

To disable a panel, either remove it from the list or set `enabled: false`:

```yaml
    - id: heartbeat
      enabled: false
```

### 5. Start the server

```bash
python server/server.py --config /path/to/workspace/config/infra/exo-dashboard.yaml
```

The server starts on `http://127.0.0.1:8768` by default. The dashboard is served at the root URL.

### 6. Reverse proxy (recommended)

For HTTPS access, put the dashboard behind a reverse proxy. Example nginx config:

```nginx
# Dashboard static files
location /exo/ {
    alias /path/to/exo-dashboard/dashboard/;
    add_header Cache-Control "no-cache, must-revalidate" always;
    try_files $uri $uri/ /exo/index.html;
}

# API and WebSocket
location /exo/api/ {
    proxy_pass http://127.0.0.1:8768/api/;
}

location /exo/ws {
    proxy_pass http://127.0.0.1:8768/ws;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_read_timeout 86400;
}
```

### 7. Run as a service (optional)

#### macOS (launchd)

The server script lives in the repo, but the config file lives in your workspace. The working directory should be your workspace root.

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>exo-dashboard</string>
    <key>ProgramArguments</key>
    <array>
        <string>/path/to/openclaw-dashboard-exo/.venv/bin/python</string>
        <string>/path/to/openclaw-dashboard-exo/server/server.py</string>
        <string>--config</string>
        <string>/path/to/workspace/config/infra/exo-dashboard.yaml</string>
    </array>
    <key>WorkingDirectory</key>
    <string>/path/to/workspace</string>
    <key>KeepAlive</key>
    <true/>
    <key>RunAtLoad</key>
    <true/>
</dict>
</plist>
```

#### Linux (systemd)

```ini
[Unit]
Description=EXO Dashboard Server
After=network.target

[Service]
ExecStart=/path/to/openclaw-dashboard-exo/.venv/bin/python /path/to/openclaw-dashboard-exo/server/server.py --config /path/to/workspace/config/infra/exo-dashboard.yaml
WorkingDirectory=/path/to/workspace
Restart=always

[Install]
WantedBy=multi-user.target
```

## Custom Panels

The dashboard ships with core panels in `dashboard/panels/core/`. You can add your own panels in `dashboard/panels/custom/` — this directory is gitignored by the main repo, so your custom code stays separate from upstream.

### How it works

When the dashboard encounters a panel id in the config that isn't a core panel, it dynamically imports it from `panels/custom/<id>/panel.js`. No changes to core code needed.

```
dashboard/panels/
  core/           ← shipped with the repo (7 core panels)
  custom/         ← gitignored, your own panels live here
    tasks/
      panel.js
    my-widget/
      panel.js
```

### Tracking custom panels in a private repo

Since `panels/custom/` is gitignored by the parent repo, you can initialise a separate git repo inside it:

```bash
cd exo-dashboard/dashboard/panels/custom
git init
git remote add origin git@github.com:yourname/exo-dashboard-custom.git
git add -A && git commit -m "Initial commit"
git push -u origin main
```

The two repos are fully independent — the parent repo ignores the custom directory entirely, and the custom repo only tracks its own panel files. On a fresh clone, pull your custom panels back in:

```bash
git clone https://github.com/jmz1/openclaw-dashboard-exo.git
cd exo-dashboard/dashboard/panels
git clone git@github.com:yourname/exo-dashboard-custom.git custom
```

### Creating a panel

1. Create `dashboard/panels/custom/<name>/panel.js`
2. Export an object conforming to the panel interface:

```js
export default {
  id: 'my-panel',           // Unique identifier (kebab-case)
  label: 'My Panel',        // Section title
  endpoints: ['/api/foo'],   // API paths this panel consumes
  placement: 'main',        // 'main' (default) | 'rail'
  keyBindings: {},           // { key: description } — auto-added to help overlay

  init({ el, state, helpers, tooltip }) {
    // Called once after DOM ready. Build your internal structure inside `el`.
    el.innerHTML = '<div class="my-content"></div>';
  },

  render({ el, state, helpers }) {
    // Called on every data refresh. Read from `state`, write to `el`.
    const data = state.foo;
    el.querySelector('.my-content').innerHTML = '...';
  },

  onKey(e) {
    // Optional. Return true if handled (stops propagation).
    return false;
  },
};
```

3. Add `{ id: 'my-panel' }` to the `dashboard.panels` list in your server config
4. Reload the dashboard — the panel loads automatically

Import helpers from core using relative paths:

```js
import { esc, ago } from '../../../core/helpers.js';
import { showTip, hideTip } from '../../../core/tooltip.js';
```

### Style guide

- **Scope CSS** under `#panel-{id}` — the core wraps each panel with this id
- **Use CSS custom properties** from `core/style.css` — never hardcode colours
- **oklch colour space only** — all colour values in `oklch()`, CVD-safe (Krzywinski palette)
- **Reuse shared components**: `.feed`, `.feed-item`, `.bar-row`, `.rm-nums`, `.detail-box`, `.stats-2x2`, `.bt-badge`, `.placeholder`
- **Geist Sans / Geist Mono** — inherited from body. Use `var(--mono)` for monospace

### Available CSS variables

| Variable | Purpose |
|----------|---------|
| `--t1`, `--t2`, `--t3` | Text: primary, secondary, muted |
| `--bg-0` to `--bg-4` | Surface levels (dark to lighter) |
| `--border`, `--border-subtle` | Divider lines |
| `--accent` | Primary accent (blue) |
| `--ok` | Success/positive (teal) |
| `--warn` | Warning (yellow) |
| `--bad` | Error/alert (magenta) |
| `--red` | Deny actions |
| `--det` | Detent/detector (purple) |
| `--mem` | Memory/remembrall (orange) |
| `--mono` | Monospace font stack |

## API Reference

| Endpoint | Description |
|----------|-------------|
| `GET /api/overview` | System health: uptime, last refresh, heartbeat state |
| `GET /api/rules` | EXO rule structure (for graph rendering) |
| `GET /api/exo/stats` | Rule firing statistics: matches, blocks, passes per rule |
| `GET /api/exo/objections` | Objection events with block context |
| `GET /api/remembrall/stats` | Activation history, write destinations, patterns |
| `GET /api/self-review` | Self-review pattern data |

| `GET /api/cron` | Cron job status, schedules, meta-processes |
| `GET /api/dashboard/config` | Panel configuration (from server YAML) |
| `WS /ws` | Push notifications on data changes |

## Design

- **Colour**: oklch throughout, protanopia-safe (Krzywinski palette). No red-green distinction.
- **Typography**: Geist Sans for text, Geist Mono for numbers/code/timestamps.
- **Layout**: Flat blocks with 1px dividers, no cards. Monospace tabular numbers. Dense but scannable.
- **Dependencies**: D3 v7 (rule graphs), Geist fonts (CDN). No build step.

## Licence

MIT
