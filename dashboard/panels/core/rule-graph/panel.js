/**
 * Rule Graph panel — D3-based per-rule flow chart visualisations.
 */
import { esc } from '../../../core/helpers.js';
import { prettifyRegex } from '../../../core/helpers.js';
import { C, BLOCK_TYPE_LABELS, BLOCK_TYPE_CSS } from '../../../core/theme.js';
import { showTip, moveTip, hideTip } from '../../../core/tooltip.js';

const RG = {
  NODE_H: 26,
  NODE_PAD: 8,
  LEVEL_GAP_X: 40,
  NODE_GAP_Y: 3,
  CLUSTER_THRESHOLD: 4,
  CLUSTER_COLS: 3,
  CLUSTER_GAP_X: 6,
  FONT_SIZE: 10,
  MIN_W: 48,
  MIN_W_GATE: 36,
};

// ── Layout engine ───────────────────────────────────────────────────────

function layoutConditionSubtree(paramEntry, nodes, links, addNode, addLink, parentId) {
  const paramName = paramEntry.param || '';
  const truncParam = paramName.length > 25 ? paramName.slice(0, 25) + '\u2026' : paramName;
  const paramId = addNode(truncParam, 'param', { fullParam: paramName });
  addLink(parentId, paramId);
  if (paramEntry.condition) {
    renderConditionNode(paramEntry.condition, nodes, links, addNode, addLink, paramId);
  }
}

function renderConditionNode(cond, nodes, links, addNode, addLink, parentId) {
  const op = cond.op;

  if (op === 'all') {
    const gateId = addNode('AND', 'gate-and');
    addLink(parentId, gateId);
    for (const child of cond.children || []) {
      renderConditionNode(child, nodes, links, addNode, addLink, gateId);
    }
    return;
  }
  if (op === 'none') {
    const gateId = addNode('NOT', 'gate-not');
    addLink(parentId, gateId);
    for (const child of cond.children || []) {
      renderConditionNode(child, nodes, links, addNode, addLink, gateId);
    }
    return;
  }
  if (op === 'contains') {
    const opId = addNode('contains', 'op-contains');
    addLink(parentId, opId);
    const val = cond.value || '';
    const label = val.length > 24 ? val.slice(0, 24) + '\u2026' : val;
    addLink(opId, addNode(label, 'leaf', { fullValue: val }));
    return;
  }
  if (op === 'containsAny') {
    const vals = cond.values || [];
    const opId = addNode('containsAny', 'op-any');
    addLink(parentId, opId);
    for (const val of vals) {
      const label = val.length > 28 ? val.slice(0, 28) + '\u2026' : val;
      addLink(opId, addNode(label, 'leaf', { fullValue: val, mode: 'any', fullValues: vals }));
    }
    return;
  }
  if (op === 'containsAll') {
    const vals = cond.values || [];
    const opId = addNode('containsAll', 'op-all');
    addLink(parentId, opId);
    for (const val of vals) {
      const label = val.length > 28 ? val.slice(0, 28) + '\u2026' : val;
      addLink(opId, addNode(label, 'leaf', { fullValue: val, mode: 'all', fullValues: vals }));
    }
    return;
  }
  if (op === 'pattern') {
    const val = cond.value || '';
    const label = val.length > 28 ? val.slice(0, 28) + '\u2026' : val;
    addLink(parentId, addNode(`/${label}/`, 'leaf-pattern', { fullPattern: val }));
    return;
  }
  if (op === 'fileContains') {
    const fcId = addNode('fileContains', 'file-read');
    addLink(parentId, fcId);
    if (cond.child) renderConditionNode(cond.child, nodes, links, addNode, addLink, fcId);
    return;
  }

  // Fallback
  const label = `${op}: ${JSON.stringify(cond.value || cond.values || '').slice(0, 30)}`;
  addLink(parentId, addNode(label, 'leaf', {}));
}

function layoutRuleTree(rule, detectors, matchStats) {
  const nodes = [];
  const links = [];
  let nodeId = 0;

  const addNode = (label, type, meta = {}) => {
    const id = nodeId++;
    nodes.push({ id, label, type, meta, x: 0, y: 0, width: 0, height: RG.NODE_H });
    return id;
  };
  const addLink = (source, target, type = 'solid') => {
    links.push({ source, target, type });
  };

  const toolId = addNode(rule.tools.join(' / '), 'tool');

  for (const param of rule.params) {
    layoutConditionSubtree(param, nodes, links, addNode, addLink, toolId);
  }

  const ac = rule.allowConditions || {};
  if (rule.blockType !== 'deny') {
    if (ac.hasGrep) {
      const kw = (rule.keywords || []).join(', ');
      addLink(toolId, addNode(`grep: ${kw.slice(0, 30)}`, 'detector'), 'dashed');
    }
    if (ac.hasMessage) addLink(toolId, addNode('message ack', 'detector'), 'dashed');
    for (const detName of ac.detectors || []) {
      if (detName.startsWith('grep:') || detName.startsWith('message:')) continue;
      addLink(toolId, addNode(detName, 'detector'), 'dashed');
    }
  }

  // BFS levels
  const levels = {};
  const queue = [{ id: toolId, level: 0 }];
  levels[toolId] = 0;
  while (queue.length) {
    const { id, level } = queue.shift();
    for (const link of links) {
      if (link.source === id && levels[link.target] === undefined) {
        levels[link.target] = level + 1;
        queue.push({ id: link.target, level: level + 1 });
      }
    }
  }

  // Measure widths
  const _canvas = document.createElement('canvas');
  const _ctx = _canvas.getContext('2d');
  _ctx.font = `${RG.FONT_SIZE}px Geist Mono, monospace`;

  for (const node of nodes) {
    const isGate = node.type === 'gate-and' || node.type === 'gate-not';
    const isOp = node.type === 'op-any' || node.type === 'op-all' || node.type === 'op-contains';
    const minW = isGate ? RG.MIN_W_GATE : RG.MIN_W;
    const tw = _ctx.measureText(node.label).width;
    const pad = isOp ? RG.NODE_PAD + RG.NODE_H * 0.35 : RG.NODE_PAD;
    node.width = Math.max(tw + pad * 2, minW);
  }

  // Build children map
  const children = {};
  for (const link of links) (children[link.source] ??= []).push(link.target);

  // Level X positions
  const byLevel = {};
  for (const node of nodes) (byLevel[levels[node.id] ?? 0] ??= []).push(node);

  const levelX = {};
  let xOffset = 0;
  for (const lvl of Object.keys(byLevel).sort((a, b) => a - b)) {
    levelX[lvl] = xOffset;
    xOffset += Math.max(...byLevel[lvl].map(n => n.width)) + RG.LEVEL_GAP_X;
  }

  const isOpNode = (n) => n.type === 'op-any' || n.type === 'op-all' || n.type === 'op-contains';

  function shouldCluster(id) {
    const node = nodes[id];
    const kids = children[id] || [];
    return isOpNode(node) && kids.length > RG.CLUSTER_THRESHOLD &&
      kids.every(k => !children[k] || children[k].length === 0);
  }

  function positionSubtree(id, yStart) {
    const node = nodes[id];
    const lvl = levels[id] ?? 0;
    node.x = levelX[lvl];
    const kids = children[id] || [];

    if (kids.length === 0) { node.y = yStart; return yStart + node.height; }

    if (shouldCluster(id)) {
      const cols = RG.CLUSTER_COLS;
      const rows = Math.ceil(kids.length / cols);
      const baseX = levelX[(levels[kids[0]] ?? 0)];
      const colWidths = [];
      for (let c = 0; c < cols; c++) {
        let maxW = 0;
        for (let r = 0; r < rows; r++) {
          const idx = r * cols + c;
          if (idx < kids.length) maxW = Math.max(maxW, nodes[kids[idx]].width);
        }
        colWidths.push(maxW);
      }
      let y = yStart;
      for (let r = 0; r < rows; r++) {
        let colX = baseX;
        for (let c = 0; c < cols; c++) {
          const idx = r * cols + c;
          if (idx >= kids.length) break;
          nodes[kids[idx]].x = colX;
          nodes[kids[idx]].y = y;
          colX += colWidths[c] + RG.CLUSTER_GAP_X;
        }
        y += RG.NODE_H + RG.NODE_GAP_Y;
      }
      const endY = yStart + rows * (RG.NODE_H + RG.NODE_GAP_Y) - RG.NODE_GAP_Y;
      const clusterMid = yStart + (endY - yStart) / 2;
      node.y = clusterMid - node.height / 2;
      return endY;
    }

    let y = yStart;
    for (const kid of kids) { y = positionSubtree(kid, y) + RG.NODE_GAP_Y; }
    y -= RG.NODE_GAP_Y;

    const firstChild = nodes[kids[0]];
    const lastChild = nodes[kids[kids.length - 1]];
    node.y = (firstChild.y + lastChild.y + lastChild.height) / 2 - node.height / 2;
    return y;
  }

  positionSubtree(toolId, 0);
  const minY = Math.min(...nodes.map(n => n.y));
  if (minY < 0) for (const node of nodes) node.y -= minY;

  return { nodes, links, levels };
}

// ── Colour helpers ──────────────────────────────────────────────────────

function getNodeColor(type) {
  const map = {
    tool: C.tool, param: C.nodeFills.param ? 'oklch(0.72 0.13 55)' : C.text,
    'gate-and': C.condition, 'gate-not': C.conditionNone,
    'op-contains': C.nodeFills['op-contains'] ? 'oklch(0.76 0.09 215)' : C.text,
    'op-any': 'oklch(0.76 0.09 215)', 'op-all': 'oklch(0.76 0.09 215)',
    leaf: C.satisfied, 'leaf-pattern': C.tool, 'file-read': C.detent,
    detector: C.detector, deny: C.deny,
  };
  return map[type] || C.textMuted;
}

function getNodeFill(type) { return C.nodeFills[type] || C.nodeFills.default; }

// ── SVG rendering ───────────────────────────────────────────────────────

function renderFlowSVG(section, layout, rule) {
  const { nodes, links } = layout;
  if (nodes.length === 0) return;

  const pad = 8;
  const maxX = Math.max(...nodes.map(n => n.x + n.width));
  const maxY = Math.max(...nodes.map(n => n.y + n.height));
  const svgW = maxX + pad * 2;
  const svgH = maxY + pad * 2;

  const div = document.createElement('div');
  div.className = 'rule-flow';

  const svg = d3.select(div).append('svg')
    .attr('viewBox', `${-pad} ${-pad} ${svgW} ${svgH}`)
    .attr('width', '100%')
    .attr('height', Math.min(svgH, 340))
    .attr('preserveAspectRatio', 'xMinYMid meet');

  for (const link of links) {
    const src = nodes[link.source];
    const tgt = nodes[link.target];
    if (!src || !tgt) continue;
    const x1 = src.x + src.width, y1 = src.y + src.height / 2;
    const x2 = tgt.x, y2 = tgt.y + tgt.height / 2;
    const mx = (x1 + x2) / 2;
    svg.append('path')
      .attr('class', 'link-path')
      .attr('d', `M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}`)
      .attr('stroke-dasharray', link.type === 'dashed' ? '3,2' : null);
  }

  function hexPath(w, h) {
    const inset = h * 0.35;
    return `M${inset},0 L${w - inset},0 L${w},${h / 2} L${w - inset},${h} L${inset},${h} L0,${h / 2} Z`;
  }

  const isGate = d => d.type === 'gate-and' || d.type === 'gate-not';
  const isOp = d => d.type === 'op-any' || d.type === 'op-all' || d.type === 'op-contains';
  const isParam = d => d.type === 'param';

  const nodeGroups = svg.selectAll('.node').data(nodes).enter().append('g')
    .attr('transform', d => `translate(${d.x}, ${d.y})`)
    .style('cursor', 'pointer');

  nodeGroups.filter(d => !isOp(d)).append('rect')
    .attr('width', d => d.width).attr('height', d => d.height)
    .attr('rx', d => isGate(d) ? 12 : isParam(d) ? 6 : 2)
    .attr('ry', d => isGate(d) ? 12 : isParam(d) ? 6 : 2)
    .attr('fill', d => getNodeFill(d.type))
    .attr('stroke', d => getNodeColor(d.type))
    .attr('stroke-width', d => isParam(d) ? 1.2 : 0.8);

  nodeGroups.filter(d => isOp(d)).append('path')
    .attr('d', d => hexPath(d.width, d.height))
    .attr('fill', d => getNodeFill(d.type))
    .attr('stroke', d => getNodeColor(d.type))
    .attr('stroke-width', 1.4);

  nodeGroups.append('text')
    .attr('x', d => d.width / 2).attr('y', d => d.height / 2 + 3.5)
    .attr('text-anchor', 'middle')
    .attr('font-family', 'Geist Mono, monospace')
    .attr('font-size', RG.FONT_SIZE)
    .attr('fill', d => (d.type === 'tool' || d.type === 'gate-and' || d.type === 'gate-not') ? getNodeColor(d.type) : C.text)
    .text(d => d.label);

  nodeGroups.on('mouseenter', (event, node) => {
    let html = '';
    if (node.type === 'leaf-pattern') {
      html = `<div style="margin-bottom:6px"><strong>Regex:</strong> <code>${esc(node.meta?.fullPattern || node.label)}</code></div>`;
      html += `<div><strong>Reads as:</strong> ${prettifyRegex(node.meta?.fullPattern || node.label)}</div>`;
    } else if (node.type === 'leaf' || node.type === 'file-read') {
      if (node.meta?.fullValues) {
        const items = node.meta.fullValues.map(v => `<code>${esc(v)}</code>`).join(', ');
        html = `<strong>${node.meta.mode === 'all' ? 'All of' : 'Any of'}:</strong> ${items}`;
      } else if (node.meta?.fullValue) html = `Match: <code>${esc(node.meta.fullValue)}</code>`;
    } else if (node.type === 'gate-and') html = 'AND — all children must match';
    else if (node.type === 'gate-not') html = 'NOT — no children may match';
    else if (node.type === 'op-contains') html = 'contains — field includes this value';
    else if (node.type === 'op-any') html = 'containsAny — field includes at least one';
    else if (node.type === 'op-all') html = 'containsAll — field includes every value';
    else if (node.type === 'tool') html = `Tool: <code>${esc(node.label)}</code>`;
    else if (node.type === 'param') html = `Parameter: <code>${esc(node.meta?.fullParam || node.label)}</code>`;
    else if (node.type === 'detector') html = `Detector: <code>${esc(node.label)}</code>`;
    if (html) showTip(event, html);
  });
  nodeGroups.on('mousemove', (event) => moveTip(event));
  nodeGroups.on('mouseleave', () => hideTip());

  section.appendChild(div);
}

// ── Panel interface ─────────────────────────────────────────────────────

let containerEl = null;

function init({ el }) {
  containerEl = el;
  el.innerHTML = '<div class="placeholder">Loading...</div>';
}

function render({ state }) {
  if (!containerEl) return;
  const rulesData = state.rules;
  if (!rulesData) { containerEl.innerHTML = '<div class="placeholder">No rules data</div>'; return; }

  const rules = rulesData.rules || [];
  const stats = state.exo || {};
  containerEl.innerHTML = '';

  // Legend
  const legend = document.createElement('div');
  legend.className = 'rule-legend';
  const legendItems = [
    { color: C.deny, label: 'Deny' }, { color: C.gate, label: 'Gate' },
    { color: C.detent, label: 'Detent' }, { sep: true },
    { color: C.tool, label: 'Tool' }, { color: C.condition, label: 'Param / AND' },
    { color: C.conditionNone, label: 'NOT' }, { color: C.satisfied, label: 'Match value' },
    { color: C.detector, label: 'Detector' },
  ];
  legend.innerHTML = legendItems.map(it => {
    if (it.sep) return '<span class="legend-div"></span>';
    return `<span class="legend-item"><span class="legend-swatch" style="background:${it.color}"></span><span class="legend-label">${it.label}</span></span>`;
  }).join('');
  containerEl.appendChild(legend);

  for (const rule of rules) {
    const section = document.createElement('div');
    section.className = 'rule-section';

    const blockType = rule.blockType || 'deny';
    const blockColor = blockType === 'gate' ? C.gate : blockType === 'detent' ? C.detent : C.deny;
    const matches = (stats.rule_matches || {})[rule.name] || 0;
    const blocks = (stats.rule_blocks || {})[rule.name] || 0;
    const satisfied = (stats.rule_satisfied || {})[rule.name] || 0;

    const ac = rule.allowConditions || {};
    let pfTags = '';
    if (blockType === 'deny') {
      pfTags = `<span class="rule-pf-tag pf-deny">unconditional</span>`;
    } else {
      const tags = [];
      if (ac.hasGrep) tags.push(`<span class="rule-pf-tag pf-grep">grep: self-review</span>`);
      if (ac.hasMessage) tags.push(`<span class="rule-pf-tag pf-message">message ack</span>`);
      for (const detName of ac.detectors || []) {
        if (detName.startsWith('grep:') || detName.startsWith('message:')) continue;
        const detCount = (stats.detector_recordings || {})[detName] || 0;
        const countBadge = detCount > 0 ? ` <span class="pf-count">${detCount}</span>` : '';
        tags.push(`<span class="rule-pf-tag pf-detector">${esc(detName)}${countBadge}</span>`);
      }
      pfTags = tags.join(' ');
    }

    let statsHtml = '';
    if (matches > 0 || blocks > 0 || satisfied > 0) {
      const parts = [];
      if (blocks > 0) parts.push(`<span class="rule-stat rule-stat-block">${blocks} blocked</span>`);
      if (satisfied > 0) parts.push(`<span class="rule-stat rule-stat-pass">${satisfied} passed</span>`);
      if (matches > 0) parts.push(`<span class="rule-stat">${matches} matches</span>`);
      statsHtml = parts.join(' ');
    }

    const bar = document.createElement('div');
    bar.className = 'rule-bar';
    bar.style.borderLeftColor = blockColor;
    bar.innerHTML = `
      <div class="rule-bar-left">
        <span class="rule-pip" style="background:${blockColor}"></span>
        <span class="rule-name">${esc(rule.name)}</span>
        <span class="rule-type-label" style="color:${blockColor}">${BLOCK_TYPE_LABELS[blockType]}</span>
      </div>
      <div class="rule-bar-right">${pfTags} ${statsHtml}</div>
    `;
    section.appendChild(bar);

    const layout = layoutRuleTree(rule, rulesData.detectors || [], stats);
    renderFlowSVG(section, layout, rule);
    containerEl.appendChild(section);
  }
}

export default {
  id: 'rule-graph',
  label: 'Rule Graph',
  endpoints: ['/api/rules', '/api/exo/stats'],
  init,
  render,
};
