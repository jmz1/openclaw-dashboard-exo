/**
 * Recent Events — event feed with detail pane.
 */
import { esc, fmtTime, fmtDateTime } from '../../../core/helpers.js';

const BT_NAMES = { 0: 'deny', 1: 'gate', 2: 'detent' };

const sel = {
  key: null,
  lastManualAt: 0,
  TIMEOUT_MS: 60_000,
  events: [],
  index: -1,
};

function eventKey(ev) {
  if (ev._kind === 'objection') return `obj|${ev.ts}|${ev.id || ''}`;
  return `exo|${ev.ts}|${ev.type}|${ev.rule || ''}|${(ev.detectors || []).join(',')}`;
}

function isManual() { return Date.now() - sel.lastManualAt < sel.TIMEOUT_MS; }

function selByIndex(idx, manual = true) {
  if (idx < 0 || idx >= sel.events.length) return;
  sel.index = idx;
  sel.key = eventKey(sel.events[idx]);
  if (manual) sel.lastManualAt = Date.now();
  renderSelUI();
}

function renderSelUI() {
  document.querySelectorAll('#panel-events .feed-item').forEach((el, i) => {
    el.classList.toggle('selected', i === sel.index);
  });
  if (sel.index >= 0 && sel.index < sel.events.length) {
    renderDetail(sel.events[sel.index]);
  }
}

function renderDetailParams(params) {
  if (!params || typeof params !== 'object') return '';
  const entries = Object.entries(params);
  if (entries.length === 0) return '';
  return `<div class="detail-params">${entries.map(([k, v]) => {
    const val = typeof v === 'string' ? v : JSON.stringify(v, null, 2);
    return `<div class="detail-param">
      <span class="detail-param-key">${esc(k)}</span>
      <span class="detail-param-val">${esc(val)}</span>
    </div>`;
  }).join('')}</div>`;
}

function renderDetail(ev) {
  const box = document.getElementById('event-detail');
  if (!box) return;

  if (ev._kind === 'objection') {
    const block = ev.block || {};
    box.innerHTML = `
      <div class="detail-header">
        <span class="detail-type c-warn">Objection</span>
        <span class="detail-time">${fmtDateTime(ev.ts)}</span>
      </div>
      <div class="detail-field"><span class="detail-key">Rule:</span> <strong>${esc(block.rule || ev.rule || 'unknown')}</strong></div>
      <div class="detail-field"><span class="detail-key">Reason:</span> <span class="objection-reason">${esc(ev.reason || '')}</span></div>
      ${block.tool ? `<div class="detail-field"><span class="detail-key">Tool:</span> <code>${esc(block.tool)}</code></div>` : ''}
      ${block.params ? `<hr class="detail-divider">${renderDetailParams(block.params)}` : ''}
    `;
    return;
  }

  const type = ev.type || '';
  const blocked = type === 'rule_blocked';
  const satisfied = type === 'rule_satisfied';
  const detected = type === 'detector_recorded';
  const matched = type === 'rule_match';
  const btName = BT_NAMES[ev.blockType] || 'deny';

  const typeLabel = blocked ? `Blocked (${btName})`
    : satisfied ? 'Satisfied'
    : detected ? 'Detector Recorded'
    : matched ? 'Rule Match'
    : type;

  const cssType = blocked ? btName : satisfied ? 'satisfied' : detected ? 'detector' : '';

  const detailRows = [];
  if (ev.rule) detailRows.push(`<div class="detail-field"><span class="detail-key">Rule:</span> <strong>${esc(ev.rule)}</strong></div>`);
  if (ev.tool) detailRows.push(`<div class="detail-field"><span class="detail-key">Tool:</span> <code>${esc(ev.tool)}</code></div>`);
  if (ev.blockType != null) {
    const colorMap = { deny: 'var(--red)', gate: 'var(--bad)', detent: 'var(--warn)' };
    detailRows.push(`<div class="detail-field"><span class="detail-key">Block type:</span> <span style="color:${colorMap[btName] || 'var(--t3)'};font-weight:600">${btName.toUpperCase()}</span></div>`);
  }
  if (ev.session) detailRows.push(`<div class="detail-field"><span class="detail-key">Session:</span> <code>${esc(ev.session)}</code></div>`);
  if (blocked && ev.acceptableDetectors?.length) {
    detailRows.push(`<div class="detail-field"><span class="detail-key">Required:</span> ${ev.acceptableDetectors.map(d => `<code>${esc(d)}</code>`).join(', ')}</div>`);
    const active = ev.activeDetectors?.length
      ? ev.activeDetectors.map(d => `<code>${esc(d)}</code>`).join(', ')
      : '<em style="color:var(--t3)">none</em>';
    detailRows.push(`<div class="detail-field"><span class="detail-key">Active:</span> ${active}</div>`);
  }
  if (detected && ev.detectors?.length) {
    detailRows.push(`<div class="detail-field"><span class="detail-key">Detectors:</span> ${ev.detectors.map(d => `<code>${esc(d)}</code>`).join(', ')}</div>`);
  }

  box.innerHTML = `
    <div class="detail-header">
      <span class="detail-type feed-type-${cssType}">${typeLabel}</span>
      <span class="detail-time">${fmtDateTime(ev.ts)}</span>
    </div>
    ${detailRows.join('')}
    ${ev.params ? `<hr class="detail-divider">${renderDetailParams(ev.params)}` : ''}
  `;
}

function renderFeedItem(ev, index) {
  if (ev._kind === 'objection') {
    return `<div class="feed-item objection-item${index === sel.index ? ' selected' : ''}" data-idx="${index}">
      <span class="feed-ts">${fmtTime(ev.ts)}</span>
      <span class="feed-type feed-type-objection">OBJCTN</span>
      <span class="feed-text">${esc(ev.reason || ev.rule || '')}</span>
    </div>`;
  }

  const type = ev.type || '';
  const cssType = type === 'rule_blocked' ? BT_NAMES[ev.blockType] || 'deny'
    : type === 'rule_satisfied' ? 'satisfied'
    : type === 'rule_match' ? BT_NAMES[ev.blockType] || 'deny'
    : type === 'detector_recorded' ? 'detector' : '';

  const label = type === 'rule_blocked' ? (BT_NAMES[ev.blockType] || 'BLOCK').toUpperCase()
    : type === 'rule_satisfied' ? 'PASS'
    : type === 'rule_match' ? 'MATCH'
    : type === 'detector_recorded' ? 'DETECT'
    : type.toUpperCase().slice(0, 6);

  let text = '';
  if (ev.rule) text = `<strong>${esc(ev.rule)}</strong>`;
  if (ev.tool) text += ` via <code>${esc(ev.tool)}</code>`;
  if (ev.detectors?.length) text += ` (${ev.detectors.map(d => esc(d)).join(', ')})`;

  return `<div class="feed-item${index === sel.index ? ' selected' : ''}" data-idx="${index}">
    <span class="feed-ts">${fmtTime(ev.ts)}</span>
    <span class="feed-type feed-type-${cssType}">${label}</span>
    <span class="feed-text">${text}</span>
  </div>`;
}

function init({ el }) {
  el.innerHTML = `
    <div class="events-two-col">
      <div class="events-feed-col">
        <div class="feed" id="event-feed"></div>
      </div>
      <div class="events-detail-col">
        <div class="detail-box" id="event-detail">
          <div class="detail-empty">No events yet</div>
        </div>
      </div>
    </div>
  `;
}

function render({ state }) {
  const feedEl = document.getElementById('event-feed');
  if (!feedEl) return;

  const savedScroll = feedEl.scrollTop;
  const followingNewest = savedScroll < 60;

  const exoEvents = (state.exo?.events || []).filter(e => e.type !== 'rule_match').map(e => ({ ...e, _kind: 'exo' }));
  const objEvents = (state.objections?.events || []).map(e => ({ ...e, _kind: 'objection' }));
  const all = [...exoEvents, ...objEvents].sort((a, b) => new Date(b.ts).getTime() - new Date(a.ts).getTime());

  sel.events = all;

  if (!isManual() && all.length > 0) {
    sel.index = 0;
    sel.key = eventKey(all[0]);
  } else if (sel.key) {
    const idx = all.findIndex(e => eventKey(e) === sel.key);
    sel.index = idx >= 0 ? idx : 0;
  }

  if (all.length === 0) {
    feedEl.innerHTML = '<div class="placeholder">No events recorded</div>';
  } else {
    feedEl.innerHTML = all.map((ev, i) => renderFeedItem(ev, i)).join('');
  }

  feedEl.querySelectorAll('.feed-item').forEach((el, i) => {
    el.addEventListener('click', () => selByIndex(i, true));
  });

  if (all.length > 0) renderDetail(all[sel.index] || all[0]);

  requestAnimationFrame(() => {
    feedEl.scrollTop = followingNewest ? 0 : savedScroll;
  });
}

function onKey(e) {
  const len = sel.events.length;
  if (len === 0) return false;

  switch (e.key) {
    case 'ArrowUp':
      e.preventDefault();
      selByIndex(Math.max(0, sel.index - 1), true);
      return true;
    case 'ArrowDown':
      e.preventDefault();
      selByIndex(Math.min(len - 1, sel.index + 1), true);
      return true;
    case 'ArrowLeft':
      e.preventDefault();
      selByIndex(0, true);
      return true;
    case 'ArrowRight':
      e.preventDefault();
      selByIndex(len - 1, true);
      return true;
  }
  return false;
}

export default {
  id: 'events',
  label: 'Recent Events',
  endpoints: ['/api/exo/stats', '/api/exo/objections'],
  keyBindings: { '↑ ↓': 'Navigate events', '← →': 'Jump to newest/oldest' },
  init,
  render,
  onKey,
};
