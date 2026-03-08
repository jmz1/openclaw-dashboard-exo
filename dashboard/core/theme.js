/**
 * Colour palette constants (Krzywinski CVD-safe, oklch).
 * Used by panels that need programmatic colour access (e.g. D3 graphs).
 * CSS should use var(--blue) etc. from style.css instead.
 */

export const C = {
  deny:     'oklch(0.58 0.16 25)',
  gate:     'oklch(0.55 0.15 350)',
  detent:   'oklch(0.84 0.12 90)',
  satisfied:'oklch(0.68 0.11 175)',
  detector: 'oklch(0.55 0.15 305)',
  tool:     'oklch(0.68 0.14 250)',
  condition:'oklch(0.68 0.11 175)',
  conditionNone: 'oklch(0.58 0.16 25)',
  link:     'oklch(0.33 0.006 270)',
  text:     'oklch(0.93 0.007 270)',
  textSec:  'oklch(0.70 0.007 270)',
  textMuted:'oklch(0.48 0.007 270)',
  bg:       'oklch(0.26 0.006 270)',
  bgNode:   'oklch(0.29 0.006 270)',
  nodeFills: {
    tool:           'oklch(0.25 0.02 250)',
    param:          'oklch(0.28 0.025 55)',
    'gate-and':     'oklch(0.25 0.015 175)',
    'gate-not':     'oklch(0.25 0.015 350)',
    leaf:           'oklch(0.25 0.015 140)',
    'leaf-pattern': 'oklch(0.25 0.015 250)',
    'file-read':    'oklch(0.25 0.015 55)',
    detector:       'oklch(0.25 0.02 305)',
    deny:           'oklch(0.25 0.015 350)',
    'op-contains':  'oklch(0.36 0.05 215)',
    'op-any':       'oklch(0.36 0.05 215)',
    'op-all':       'oklch(0.36 0.05 215)',
    default:        'oklch(0.26 0.006 270)',
  },
};

export const BLOCK_TYPE_LABELS = { deny: 'DENY', gate: 'GATE', detent: 'DETENT' };
export const BLOCK_TYPE_CSS    = { deny: 'deny', gate: 'gate', detent: 'detent' };
