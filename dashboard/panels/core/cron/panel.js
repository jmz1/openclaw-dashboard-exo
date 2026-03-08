/**
 * Cron / Scheduled Processes panel.
 */
import { esc, ago, timeUntil, fmtDuration } from '../../../core/helpers.js';

function init({ el }) {
  el.innerHTML = '<div class="cron-panel"><p class="placeholder">Loading...</p></div>';
}

function renderJob(job) {
  const enabled = job.enabled;
  const name = esc(job.name);
  const schedule = esc(job.schedule);
  const status = job.last_status || '';
  const lastRun = job.last_run_at ? ago(job.last_run_at) : 'never';
  const nextRun = job.next_run_at ? timeUntil(job.next_run_at) : '';
  const duration = job.last_duration_ms ? fmtDuration(job.last_duration_ms) : '';
  const errors = job.consecutive_errors || 0;
  const meta = job.meta_process;

  const statusCls = !enabled ? 'cron-disabled'
    : errors > 0 ? 'cron-error'
    : status === 'ok' ? 'cron-ok'
    : 'cron-unknown';

  const statusLabel = !enabled ? 'OFF'
    : errors > 0 ? 'ERR'
    : status === 'ok' ? 'OK'
    : '\u2014';

  const metaBadge = meta
    ? ` <span class="cron-meta-badge" title="${esc(meta)}">◆ process</span>`
    : '';

  const deliveryIcon = job.last_delivered === true ? '✓'
    : job.last_delivered === false ? '✗'
    : '';
  const deliveryCls = job.last_delivered === true ? 'cron-delivered' : 'cron-not-delivered';

  return `<div class="cron-item ${enabled ? '' : 'cron-item-disabled'}">
    <span class="cron-status ${statusCls}">${statusLabel}</span>
    <span class="cron-name">${name}${metaBadge}</span>
    <span class="cron-schedule">${schedule}</span>
    <span class="cron-last-run" title="Last run">${lastRun}</span>
    <span class="cron-duration">${duration}</span>
    <span class="cron-delivery ${deliveryCls}" title="Last delivery: ${esc(job.last_delivery_status)}">${deliveryIcon}</span>
    <span class="cron-next-run" title="Next run">${nextRun}</span>
  </div>`;
}

function render({ el, state }) {
  const panel = el.querySelector('.cron-panel');
  const data = state.cron;

  if (!data || !data.jobs) {
    panel.innerHTML = '<div class="placeholder">No cron data</div>';
    return;
  }

  if (data.jobs.length === 0) {
    panel.innerHTML = '<div class="placeholder">No cron jobs configured</div>';
    return;
  }

  panel.innerHTML = `<div class="cron-list">${data.jobs.map(renderJob).join('')}</div>`;
}

export default {
  id: 'cron',
  label: 'Scheduled Processes',
  endpoints: ['/api/cron'],
  init,
  render,
};
