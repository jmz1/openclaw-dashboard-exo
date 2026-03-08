/**
 * Shared tooltip — single instance, positioned near cursor.
 */
import { $ } from './helpers.js';

function posTip(tip, event) {
  const pad = 12;
  const rect = tip.getBoundingClientRect();
  let x = event.clientX + pad;
  let y = event.clientY + pad;
  if (x + rect.width > window.innerWidth - pad) x = event.clientX - rect.width - pad;
  if (y + rect.height > window.innerHeight - pad) y = event.clientY - rect.height - pad;
  tip.style.left = `${x + window.scrollX}px`;
  tip.style.top = `${y + window.scrollY}px`;
}

export function showTip(event, html) {
  const tip = $('tip');
  if (!tip) return;
  tip.innerHTML = html;
  tip.classList.add('visible');
  posTip(tip, event);
}

export function moveTip(event) {
  const tip = $('tip');
  if (tip) posTip(tip, event);
}

export function hideTip() {
  const tip = $('tip');
  if (tip) tip.classList.remove('visible');
}
