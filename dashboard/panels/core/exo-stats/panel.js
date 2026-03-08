/**
 * EXO Statistics — 2×2 grid: Deny, Gate, Detent, Objections.
 */
import { esc, pct } from '../../../core/helpers.js';

function classifyRule(rule) {
  if (rule.blockType === 'detent') return 2;
  if (rule.blockType === 'gate') return 1;
  return 0;
}

function buildGroups(rules, stats) {
  const groups = { 0: [], 1: [], 2: [] };
  for (const rule of rules) {
    const bt = classifyRule(rule);
    const name = rule.name;
    const matches = (stats.rule_matches || {})[name] || 0;
    const blocks = (stats.rule_blocks || {})[name] || 0;
    const satisfied = (stats.rule_satisfied || {})[name] || 0;
    groups[bt].push({ name, matches, blocks, satisfied, total: matches });
  }
  for (const g of Object.values(groups)) {
    g.sort((a, b) => b.total - a.total);
  }
  return groups;
}

function renderBarRows(container, items, colorVar, showStacked = false) {
  if (items.length === 0) {
    container.innerHTML = '<div class="q-empty">No activity</div>';
    return;
  }

  const max = Math.max(...items.map(r => r.total), 1);

  container.innerHTML = items.map(r => {
    const name = esc(r.name);
    if (showStacked && (r.blocks > 0 || r.satisfied > 0)) {
      const bPct = pct(r.blocks, max);
      const sPct = pct(r.satisfied, max);
      return `<div class="bar-row">
        <span class="bar-name" title="${name}">${name}</span>
        <div class="bar-track">
          <div class="bar-fill-stacked">
            <span style="width:${bPct}%; background:${colorVar};"></span>
            <span style="width:${sPct}%; background:var(--ok);"></span>
          </div>
        </div>
        <span class="bar-count">${r.blocks}b / ${r.satisfied}p</span>
      </div>`;
    }
    const w = pct(r.total, max);
    return `<div class="bar-row">
      <span class="bar-name" title="${name}">${name}</span>
      <div class="bar-track">
        <div class="bar-fill" style="width:${w}%; background:${colorVar};"></div>
      </div>
      <span class="bar-count">${r.total}</span>
    </div>`;
  }).join('');
}

function init({ el }) {
  el.innerHTML = `
    <div class="stats-2x2">
      <div class="stats-quadrant" id="q-deny">
        <h3 class="q-heading deny">Deny</h3>
        <div class="q-body"></div>
      </div>
      <div class="stats-quadrant" id="q-gate">
        <h3 class="q-heading gate">Gate</h3>
        <div class="q-body"></div>
      </div>
      <div class="stats-quadrant" id="q-detent">
        <h3 class="q-heading detent">Detent</h3>
        <div class="q-body"></div>
      </div>
      <div class="stats-quadrant" id="q-objections">
        <h3 class="q-heading objections">Objections</h3>
        <div class="q-body"></div>
      </div>
    </div>
  `;
}

function render({ state }) {
  const rules = state.rules?.rules || [];
  const stats = state.exo || {};
  const obj = state.objections || {};
  const groups = buildGroups(rules, stats);

  renderBarRows(document.querySelector('#q-deny .q-body'), groups[0], 'var(--red)');
  renderBarRows(document.querySelector('#q-gate .q-body'), groups[1], 'var(--bad)', true);
  renderBarRows(document.querySelector('#q-detent .q-body'), groups[2], 'var(--warn)', true);

  const objByRule = obj.by_rule || {};
  const objItems = Object.entries(objByRule)
    .map(([name, count]) => ({ name, total: count, blocks: 0, satisfied: 0 }))
    .sort((a, b) => b.total - a.total);
  renderBarRows(document.querySelector('#q-objections .q-body'), objItems, 'var(--orange)');
}

export default {
  id: 'exo-stats',
  label: 'EXO Statistics',
  endpoints: ['/api/rules', '/api/exo/stats', '/api/exo/objections'],
  init,
  render,
};
