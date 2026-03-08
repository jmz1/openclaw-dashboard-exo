/**
 * Shared helpers — pure functions, no side effects.
 */

export function $(id) { return document.getElementById(id); }

export function esc(s) {
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}

export function pct(n, d) {
  if (!d) return 0;
  return Math.round((n / d) * 100);
}

export function ago(ts) {
  if (!ts) return 'never';
  const ms = Date.now() - (typeof ts === 'number' && ts < 1e12 ? ts * 1000 : ts);
  if (ms < 60000) return 'just now';
  if (ms < 3600000) return `${Math.floor(ms / 60000)}m ago`;
  if (ms < 86400000) return `${Math.floor(ms / 3600000)}h ago`;
  return `${Math.floor(ms / 86400000)}d ago`;
}

export function fmtTime(ts) {
  if (!ts) return '';
  try {
    const d = new Date(ts);
    return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', hour12: false });
  } catch { return ts.slice(11, 16); }
}

export function fmtDate(ts) {
  if (!ts) return '';
  return ts.slice(5, 10);
}

export function fmtDateTime(ts) {
  if (!ts) return '';
  return `${fmtDate(ts)} ${fmtTime(ts)}`;
}

export function truncPath(path) {
  if (!path) return 'unknown';
  const parts = path.split('/');
  return parts.length > 2 ? '\u2026/' + parts.slice(-2).join('/') : path;
}

export function timeUntil(ms) {
  const diff = ms - Date.now();
  if (diff < 0) return 'overdue';
  if (diff < 60000) return 'soon';
  if (diff < 3600000) return `in ${Math.floor(diff / 60000)}m`;
  if (diff < 86400000) return `in ${Math.floor(diff / 3600000)}h`;
  return `in ${Math.floor(diff / 86400000)}d`;
}

export function fmtDuration(ms) {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(0)}s`;
  if (ms < 3600000) return `${Math.floor(ms / 60000)}m ${Math.floor((ms % 60000) / 1000)}s`;
  return `${(ms / 3600000).toFixed(1)}h`;
}

/**
 * Prettify a regex pattern into human-readable HTML.
 */
export function prettifyRegex(raw) {
  if (!raw) return '';

  function explain(s) {
    const subs = [
      [/\(\?:([^)]+)\)/g, (_, inner) => `<span class="rx-tok rx-group">(${inner.replace(/\|/g, ' | ')})</span>`],
      [/\(\?!([^)]+)\)/g, (_, inner) => `<span class="rx-tok rx-meta">not followed by</span> <code class="rx-tok">${esc(inner)}</code>`],
      [/\(\?<=([^)]+)\)/g, (_, inner) => `<span class="rx-tok rx-meta">preceded by</span> <code class="rx-tok">${esc(inner)}</code>`],
      [/\(\?<!([^)]+)\)/g, (_, inner) => `<span class="rx-tok rx-meta">not preceded by</span> <code class="rx-tok">${esc(inner)}</code>`],
      [/\\b/g, () => `<span class="rx-tok rx-meta">word boundary</span>`],
      [/\\d/g, () => `<span class="rx-tok rx-class">digit</span>`],
      [/\\w/g, () => `<span class="rx-tok rx-class">word char</span>`],
      [/\\s/g, () => `<span class="rx-tok rx-class">whitespace</span>`],
      [/\.\*/g, () => `<span class="rx-tok rx-meta">anything</span>`],
      [/\.\+/g, () => `<span class="rx-tok rx-meta">one or more of anything</span>`],
      [/\[([^\]]+)\]/g, (_, inner) => `<span class="rx-tok rx-class">[${esc(inner)}]</span>`],
    ];
    let result = s;
    for (const [re, fn] of subs) result = result.replace(re, fn);
    return result;
  }

  let depth = 0, current = '';
  const parts = [];
  for (const ch of raw) {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === '|' && depth === 0) { parts.push(current); current = ''; continue; }
    current += ch;
  }
  parts.push(current);

  if (parts.length > 1) {
    return `<span class="rx-flow">${parts.map(p => explain(p)).join(' <span class="rx-tok rx-meta">or</span> ')}</span>`;
  }
  return `<span class="rx-flow">${explain(raw)}</span>`;
}
