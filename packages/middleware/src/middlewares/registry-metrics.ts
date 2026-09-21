export interface RegistryEventMetrics {
  publishes: number;
  unpublishes: number;
  tarballDownloads: number;
}

const counters: RegistryEventMetrics = {
  publishes: 0,
  unpublishes: 0,
  tarballDownloads: 0,
};

/**
 * In-process counters for registry write/download events, exposed through the
 * Prometheus scrape endpoint and the admin metrics API.
 */
export function recordRegistryEvent(event: keyof RegistryEventMetrics): void {
  counters[event] += 1;
}

export function getRegistryMetrics(): RegistryEventMetrics {
  return { ...counters };
}
