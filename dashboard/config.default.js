/**
 * Default dashboard configuration.
 *
 * Used as fallback when the server doesn't provide a dashboard config
 * (i.e. no `dashboard:` section in the server's YAML config).
 *
 * To customise: add a `dashboard.panels` section to your exo-dashboard.yaml
 * rather than editing this file. See config.example.yaml.
 */
export default {
  panels: [
    { id: 'exo-stats',    enabled: true },
    { id: 'events',       enabled: true },
    { id: 'rule-graph',   enabled: true },
    { id: 'cron',         enabled: true },
    { id: 'heartbeat',    enabled: true },
    { id: 'remembrall',   enabled: true },
    { id: 'metrics-rail', enabled: true },
  ],
};
