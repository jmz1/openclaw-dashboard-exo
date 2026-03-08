/**
 * Core app — panel registry, data loading, WebSocket, keyboard routing.
 *
 * Config resolution:
 *   1. Fetch /api/dashboard/config (from server's YAML config)
 *   2. Fall back to config.default.js (built-in defaults)
 *
 * Panel resolution:
 *   - Core panels: statically imported from panels/core/
 *   - Custom panels: dynamically imported from panels/custom/<id>/panel.js
 */
import defaults from '../config.default.js';
import * as helpers from './helpers.js';
import * as tooltip from './tooltip.js';

// Core panel imports (always available)
import cron from '../panels/core/cron/panel.js';
import exoStats from '../panels/core/exo-stats/panel.js';
import events from '../panels/core/events/panel.js';
import ruleGraph from '../panels/core/rule-graph/panel.js';
import heartbeat from '../panels/core/heartbeat/panel.js';
import remembrall from '../panels/core/remembrall/panel.js';
import metricsRail from '../panels/core/metrics-rail/panel.js';

const { $, ago } = helpers;

// ── Registry ────────────────────────────────────────────────────────────

const CORE_PANELS = new Map(
  [cron, exoStats, events, ruleGraph, heartbeat, remembrall, metricsRail]
    .map(p => [p.id, p])
);

/** All loaded panels (core + custom). */
const allPanels = new Map(CORE_PANELS);

/** Active panels in config order, with their container elements. */
const activePanels = [];

// ── Shared state ────────────────────────────────────────────────────────

const state = {
  overview: null,
  rules: null,
  exo: null,
  objections: null,
  remembrall: null,
  selfReview: null,
  tasks: null,
  cron: null,
};

// ── API ─────────────────────────────────────────────────────────────────

const API = window.location.pathname.replace(/\/$/, '');

async function get(path) {
  const r = await fetch(`${API}${path}`);
  if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
  return r.json();
}

// ── Config resolution ───────────────────────────────────────────────────

async function resolveConfig() {
  try {
    const r = await fetch(`${API}/api/dashboard/config`);
    if (r.ok && r.status !== 204) {
      const remote = await r.json();
      if (remote && remote.panels && remote.panels.length > 0) {
        console.log(`[exo] Loaded panel config from server (${remote.panels.length} panels)`);
        return remote;
      }
    }
  } catch (err) {
    console.warn('[exo] Failed to fetch server config, using defaults:', err.message);
  }
  console.log(`[exo] Using default panel config (${defaults.panels.length} panels)`);
  return defaults;
}

// ── Custom panel loading ────────────────────────────────────────────────

async function loadCustomPanels(config) {
  const customIds = config.panels
    .filter(e => e.enabled !== false && !CORE_PANELS.has(e.id))
    .map(e => e.id);

  for (const id of customIds) {
    try {
      const mod = await import(`../panels/custom/${id}/panel.js`);
      const panel = mod.default;
      if (panel && panel.id) {
        allPanels.set(panel.id, panel);
        console.log(`[exo] Loaded custom panel: ${id}`);
      }
    } catch (err) {
      console.warn(`[exo] Failed to load custom panel "${id}":`, err.message);
    }
  }
}

// ── Panel lifecycle ─────────────────────────────────────────────────────

function mountPanels(config) {
  const main = $('panels');
  const rail = $('metrics-rail');

  for (const entry of config.panels) {
    if (entry.enabled === false) continue;
    const panel = allPanels.get(entry.id);
    if (!panel) { console.warn(`[exo] Unknown panel: ${entry.id}`); continue; }

    const placement = panel.placement || 'main';
    let el;

    if (placement === 'rail') {
      el = rail;
    } else {
      el = document.createElement('section');
      el.className = 'block';
      el.id = `panel-${panel.id}`;
      const h2 = document.createElement('h2');
      h2.className = 'block-title';
      h2.textContent = panel.label;
      el.appendChild(h2);
      const content = document.createElement('div');
      content.className = 'panel-content';
      el.appendChild(content);
      main.appendChild(el);
    }

    const ctx = { el: placement === 'rail' ? el : el.querySelector('.panel-content'), state, helpers, tooltip, config: entry };
    panel.init(ctx);
    activePanels.push({ panel, ctx });
  }
}

function renderAll() {
  for (const { panel, ctx } of activePanels) {
    panel.render(ctx);
  }

  const lr = state.overview?.last_refresh;
  const el = $('last-refresh');
  if (el) el.textContent = lr ? `refreshed ${ago(lr * 1000)}` : '';
}

// ── Data loading ────────────────────────────────────────────────────────

function requiredEndpoints() {
  const seen = new Set();
  for (const { panel } of activePanels) {
    for (const ep of panel.endpoints) seen.add(ep);
  }
  return [...seen];
}

const EP_STATE_MAP = {
  '/api/overview':         'overview',
  '/api/rules':            'rules',
  '/api/exo/stats':        'exo',
  '/api/exo/objections':   'objections',
  '/api/remembrall/stats': 'remembrall',
  '/api/self-review':      'selfReview',
  '/api/tasks':            'tasks',
  '/api/cron':             'cron',
  '/api/heartbeat':        'overview',
};

async function loadAll() {
  try {
    const endpoints = requiredEndpoints();
    const results = await Promise.all(endpoints.map(ep => get(ep)));
    endpoints.forEach((ep, i) => {
      const key = EP_STATE_MAP[ep];
      if (key) state[key] = results[i];
    });
    renderAll();
  } catch (err) {
    console.error('Load failed:', err);
  }
}

// ── WebSocket ───────────────────────────────────────────────────────────

let ws = null;
let wsRetry = 1000;

function initWS() {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const url = `${proto}//${location.host}${API}/ws`;
  ws = new WebSocket(url);

  ws.addEventListener('open', () => {
    $('ws-dot')?.classList.add('connected');
    $('ws-dot').title = 'WebSocket connected';
    wsRetry = 1000;
  });

  ws.addEventListener('close', () => {
    $('ws-dot')?.classList.remove('connected');
    $('ws-dot').title = 'WebSocket disconnected';
    setTimeout(initWS, Math.min(wsRetry *= 1.5, 30000));
  });

  ws.addEventListener('message', (ev) => {
    try {
      const msg = JSON.parse(ev.data);
      if (msg.type === 'refresh') loadAll();
      if (msg.type === 'ping') ws.send(JSON.stringify({ type: 'pong' }));
    } catch { /* ignore */ }
  });
}

// ── Clock ───────────────────────────────────────────────────────────────

function updateClock() {
  const el = $('strip-time');
  if (el) el.textContent = new Date().toLocaleTimeString(undefined, {
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  });
}

// ── Keyboard ────────────────────────────────────────────────────────────

function initKeyboard() {
  document.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

    if (e.key === '?') { $('help-overlay').classList.toggle('visible'); return; }
    if (e.key === 'Escape') { $('help-overlay').classList.remove('visible'); return; }
    if (e.key === 'r' && !e.ctrlKey && !e.metaKey) { loadAll(); return; }

    for (const { panel } of activePanels) {
      if (panel.onKey && panel.onKey(e)) return;
    }
  });

  $('help-btn')?.addEventListener('click', () => $('help-overlay').classList.toggle('visible'));
}

function buildHelpTable() {
  const tbody = $('help-shortcuts');
  if (!tbody) return;

  const globals = [
    ['?', 'Toggle this help'],
    ['Esc', 'Close overlay'],
    ['r', 'Refresh all data'],
  ];

  let html = globals.map(([k, desc]) =>
    `<tr><td><kbd>${k}</kbd></td><td>${helpers.esc(desc)}</td></tr>`
  ).join('');

  for (const { panel } of activePanels) {
    if (!panel.keyBindings || Object.keys(panel.keyBindings).length === 0) continue;
    html += `<tr><td colspan="2" class="help-sep">${helpers.esc(panel.label)}</td></tr>`;
    for (const [key, desc] of Object.entries(panel.keyBindings)) {
      html += `<tr><td><kbd>${helpers.esc(key)}</kbd></td><td>${helpers.esc(desc)}</td></tr>`;
    }
  }

  tbody.innerHTML = html;
}

// ── Init ────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', async () => {
  updateClock();
  setInterval(updateClock, 1000);

  const config = await resolveConfig();
  await loadCustomPanels(config);
  mountPanels(config);
  buildHelpTable();
  initKeyboard();
  loadAll();
  initWS();
});
