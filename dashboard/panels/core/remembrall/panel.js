/**
 * Remembrall panel — activation history, write destinations, pattern frequency.
 */
import { esc, pct, fmtTime, fmtDate, truncPath, prettifyRegex } from '../../../core/helpers.js';

function renderRmEvent(event) {
  const type = event.type || '';
  const time = fmtTime(event.ts);
  const date = fmtDate(event.ts);

  if (type === 'activation') {
    const writes = event.subsequent_writes || [];
    const resolved = event.resolved;
    const matchedText = (event.matchedText || '').slice(0, 80);
    const matchTitle = (event.matchedText || '').length > 80
      ? ` title="${esc(event.matchedText)}"` : '';

    if (resolved && writes.length > 0) {
      const targets = writes.map(w => `<div class="rm-event-target">${esc(truncPath(w.file || w.path))}</div>`).join('');
      return `<div class="rm-event">
        <span class="rm-event-icon rm-icon-ok">OK</span>
        <div class="rm-event-body">
          <div class="rm-event-head"><strong>Nudged + wrote</strong><span class="rm-event-time">${date} ${time}</span></div>
          <div class="rm-event-match"${matchTitle}>${esc(matchedText)}</div>
          ${targets}
        </div>
      </div>`;
    }

    if (!resolved && writes.length === 0) {
      return `<div class="rm-event">
        <span class="rm-event-icon rm-icon-miss">MISS</span>
        <div class="rm-event-body">
          <div class="rm-event-head"><strong>Nudged — no write followed</strong><span class="rm-event-time">${date} ${time}</span></div>
          <div class="rm-event-match"${matchTitle}>${esc(matchedText)}</div>
          <div class="rm-event-miss">No write followed this activation</div>
        </div>
      </div>`;
    }

    if (resolved && writes.length === 0) {
      return `<div class="rm-event">
        <span class="rm-event-icon rm-icon-nudge">SAT</span>
        <div class="rm-event-body">
          <div class="rm-event-head"><strong>Pattern satisfied (good behaviour)</strong><span class="rm-event-time">${date} ${time}</span></div>
          <div class="rm-event-match"${matchTitle}>${esc(matchedText)}</div>
        </div>
      </div>`;
    }

    if (writes.length > 0) {
      const targets = writes.map(w => `<div class="rm-event-target">${esc(truncPath(w.file || w.path))}</div>`).join('');
      return `<div class="rm-event">
        <span class="rm-event-icon rm-icon-nudge">WRT</span>
        <div class="rm-event-body">
          <div class="rm-event-head"><strong>Nudged + wrote</strong><span class="rm-event-time">${date} ${time}</span></div>
          <div class="rm-event-match"${matchTitle}>${esc(matchedText)}</div>
          ${targets}
        </div>
      </div>`;
    }

    return `<div class="rm-event">
      <span class="rm-event-icon rm-icon-nudge">ACT</span>
      <div class="rm-event-body">
        <div class="rm-event-head"><strong>Activation</strong><span class="rm-event-time">${date} ${time}</span></div>
        <div class="rm-event-match"${matchTitle}>${esc(matchedText)}</div>
      </div>
    </div>`;
  }

  if (type === 'write') {
    return `<div class="rm-event">
      <span class="rm-event-icon rm-icon-ok">WRT</span>
      <div class="rm-event-body">
        <div class="rm-event-head"><strong>Write</strong><span class="rm-event-time">${date} ${time}</span></div>
        <div class="rm-event-target">${esc(truncPath(event.file || event.path || ''))}</div>
      </div>
    </div>`;
  }

  return '';
}

function init({ el }) {
  el.innerHTML = '<div class="rm-panel"><p class="placeholder">Loading...</p></div>';
}

function render({ el, state }) {
  const container = el.querySelector('.rm-panel');
  const stats = state.remembrall || {};
  const events = stats.events || [];
  const activations = stats.total_activations || 0;
  const satisfied = stats.total_satisfied || 0;
  const resolved = stats.resolved_activations || 0;
  const unresolved = stats.unresolved_activations || 0;
  const rate = activations > 0 ? `${(stats.resolution_rate || 0).toFixed(0)}%` : '\u2014';

  const feedEl = container.querySelector('.rm-feed');
  const savedScroll = feedEl ? feedEl.scrollTop : 0;

  container.innerHTML = `
    <div class="rm-nums">
      <div class="rm-num"><div class="rm-num-val">${activations}</div><div class="rm-num-label">Activations</div></div>
      <div class="rm-num"><div class="rm-num-val c-ok">${satisfied}</div><div class="rm-num-label">Satisfied</div></div>
      <div class="rm-num"><div class="rm-num-val c-accent">${resolved}</div><div class="rm-num-label">Resolved</div></div>
      <div class="rm-num"><div class="rm-num-val c-warn">${unresolved}</div><div class="rm-num-label">Unresolved</div></div>
      <div class="rm-num"><div class="rm-num-val c-ok">${rate}</div><div class="rm-num-label">Resolution Rate</div></div>
    </div>
    <div class="rm-cols">
      <div class="rm-col-left">
        <div class="rm-sub-title">Activation History</div>
        <div class="rm-feed" id="rm-events"></div>
      </div>
      <div class="rm-col-right">
        <div class="rm-sub-title">Write Destinations</div>
        <div id="rm-destinations"></div>
        <div class="rm-sub-title" style="margin-top: 12px;">Pattern Frequency</div>
        <div id="rm-patterns"></div>
      </div>
    </div>
  `;

  // Event feed
  const feedContainer = document.getElementById('rm-events');
  if (events.length === 0) {
    feedContainer.innerHTML = '<div class="placeholder">No events recorded</div>';
  } else {
    feedContainer.innerHTML = [...events].reverse().map(renderRmEvent).join('');
  }

  // Destinations
  const destContainer = document.getElementById('rm-destinations');
  const dests = stats.write_destinations || {};
  const destEntries = Object.entries(dests).sort((a, b) => b[1] - a[1]);
  if (destEntries.length === 0) {
    destContainer.innerHTML = '<div class="placeholder">No writes yet</div>';
  } else {
    destContainer.innerHTML = destEntries.slice(0, 10).map(([path, count]) =>
      `<div class="rm-dest-row">
        <span class="rm-dest-path" title="${esc(path)}">${esc(truncPath(path))}</span>
        <span class="rm-dest-count">${count}</span>
      </div>`
    ).join('');
  }

  // Pattern frequency
  const patContainer = document.getElementById('rm-patterns');
  const pats = stats.pattern_frequency || {};
  const patEntries = Object.entries(pats).sort((a, b) => b[1] - a[1]);
  if (patEntries.length === 0) {
    patContainer.innerHTML = '<div class="placeholder">No patterns yet</div>';
  } else {
    const shown = patEntries.slice(0, 8);
    const maxPat = Math.max(...shown.map(([, c]) => c), 1);
    patContainer.innerHTML = shown.map(([pattern, count]) => {
      const w = pct(count, maxPat);
      const pretty = prettifyRegex(pattern);
      return `<div class="rm-pat-row">
        <div class="rm-pat-head">
          <span class="rm-pat-label">${pretty}</span>
          <span class="rm-pat-count">${count}</span>
        </div>
        <div class="rm-pat-bar"><div class="rm-pat-fill" style="width:${w}%"></div></div>
      </div>`;
    }).join('');
  }

  requestAnimationFrame(() => {
    const newFeed = container.querySelector('.rm-feed');
    if (newFeed) newFeed.scrollTop = savedScroll;
  });
}

export default {
  id: 'remembrall',
  label: 'Remembrall',
  endpoints: ['/api/remembrall/stats'],
  init,
  render,
};
