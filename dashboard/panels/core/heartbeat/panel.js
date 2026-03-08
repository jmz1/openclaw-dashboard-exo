/**
 * Heartbeat panel — shows last check timestamps.
 */
import { ago, esc } from '../../../core/helpers.js';

const ITEMS = [
  { key: 'email',                  label: 'Email' },
  { key: 'calendar',              label: 'Calendar' },
  { key: 'weather',               label: 'Weather' },
  { key: 'memoryMaintenance',     label: 'Memory' },
  { key: 'selfReviewMaintenance', label: 'Self-Review' },
];

function init({ el }) {
  el.classList.add('block-sm');
  el.innerHTML = '<div class="hb-row"></div>';
}

function render({ el, state }) {
  const row = el.querySelector('.hb-row');
  const ov = state.overview || {};
  const hb = ov.heartbeat || {};

  if (!hb || Object.keys(hb).length === 0) {
    row.innerHTML = '<div class="placeholder">No heartbeat data</div>';
    return;
  }

  const checks = hb.last_checks || hb.lastChecks || hb;

  row.innerHTML = ITEMS.map(({ key, label }) => {
    const ts = checks[key];
    const a = ago(ts);
    let cls = 'hb-fresh';
    if (!ts) cls = 'hb-overdue';
    else {
      const msAgo = Date.now() - (ts < 1e12 ? ts * 1000 : ts);
      if (msAgo > 86400000 * 2) cls = 'hb-overdue';
      else if (msAgo > 86400000) cls = 'hb-stale';
    }
    return `<div class="hb-item">
      <div class="hb-label">${esc(label)}</div>
      <div class="hb-val ${cls}">${a}</div>
    </div>`;
  }).join('');
}

export default {
  id: 'heartbeat',
  label: 'Heartbeat',
  endpoints: ['/api/overview'],
  init,
  render,
};
