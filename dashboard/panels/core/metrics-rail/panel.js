/**
 * Metrics Rail — bottom summary strip.
 *
 * Core items (EXO rules, matches, blocks, pass rate, objections, crons) always
 * render. Provider-contributed items (remembrall, tasks, etc.) render only when
 * their data is present in state — providers populate state via /api/overview.
 */
import { pct } from '../../../core/helpers.js';

/** @typedef {{ label: string, value: string|number, cls?: string, detail?: string }} RailItem */

/**
 * Build the list of rail items from current state.
 * Core items always appear; provider items appear only when data exists.
 * @param {object} state
 * @returns {RailItem[]}
 */
function buildItems(state) {
  const rules = state.rules?.rules || [];
  const stats = state.exo || {};
  const obj = state.objections || {};

  const totalMatches = Object.values(stats.rule_matches || {}).reduce((a, b) => a + b, 0);
  const totalBlocks = Object.values(stats.rule_blocks || {}).reduce((a, b) => a + b, 0);
  const totalPassed = Object.values(stats.rule_satisfied || {}).reduce((a, b) => a + b, 0);
  const passRate = totalMatches ? pct(totalPassed, totalMatches) : 0;

  const denyCount = rules.filter(r => r.blockType === 'deny').length;
  const gateCount = rules.filter(r => r.blockType === 'gate').length;
  const detentCount = rules.filter(r => r.blockType === 'detent').length;

  /** @type {RailItem[]} */
  const items = [
    { label: 'Rules', value: rules.length, cls: 'c-accent', detail: `${denyCount}d ${gateCount}g ${detentCount}t` },
    { label: 'Matches', value: totalMatches, detail: `${totalBlocks} blocked` },
    { label: 'Blocks', value: totalBlocks, cls: 'c-bad', detail: `${totalPassed} passed` },
    { label: 'Pass Rate', value: `${passRate}%`, cls: 'c-ok' },
    { label: 'Objections', value: obj.total || 0, cls: 'c-warn', detail: `${Object.keys(obj.by_rule || {}).length} rules` },
  ];

  // Provider-contributed items — only render when data present
  const rem = state.remembrall;
  if (rem && rem.total_activations != null) {
    items.push({
      label: 'Remembrall',
      value: rem.total_activations,
      cls: 'c-mem',
      detail: `${rem.resolved_activations || 0} resolved`,
    });
  }

  const tasks = state.tasks;
  if (tasks?.counts) {
    const c = tasks.counts;
    items.push({
      label: 'Tasks',
      value: c.pending || 0,
      detail: `${c.inbox || 0} inbox · ${c.overdue || 0} overdue${c.overnight ? ` · ${c.overnight} ☽` : ''}`,
    });
  }

  // Cron is core but may have no data
  const cron = state.cron?.counts;
  if (cron) {
    items.push({
      label: 'Crons',
      value: cron.active || 0,
      detail: `${cron.errored || 0} errors · ${cron.with_process || 0} w/process`,
    });
  }

  return items;
}

function renderItem(item) {
  const cls = item.cls ? ` ${item.cls}` : '';
  const detail = item.detail ? `<div class="rail-detail">${item.detail}</div>` : '';
  return `<div class="rail-item">
    <div class="rail-label">${item.label}</div>
    <div class="rail-value${cls}">${item.value}</div>
    ${detail}
  </div>`;
}

function init() {}

function render({ el, state }) {
  el.innerHTML = buildItems(state).map(renderItem).join('');
}

export default {
  id: 'metrics-rail',
  label: 'Metrics',
  placement: 'rail',
  endpoints: ['/api/rules', '/api/exo/stats', '/api/exo/objections', '/api/remembrall/stats', '/api/tasks', '/api/cron'],
  init,
  render,
};
