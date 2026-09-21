export interface AdminAuditEntry {
  time: string;
  actor: string;
  action: string;
  target?: string;
  detail?: string;
}

const MAX_ENTRIES = 500;
const entries: AdminAuditEntry[] = [];

/**
 * Records an administrative action. In-memory and process-local: it answers
 * "who changed what recently", it is not a compliance audit trail.
 */
export function recordAdminAction(
  actor: string | void | undefined,
  action: string,
  target?: string,
  detail?: string
): void {
  entries.push({
    time: new Date().toISOString(),
    actor: actor ?? 'unknown',
    action,
    target,
    detail,
  });
  if (entries.length > MAX_ENTRIES) {
    entries.splice(0, entries.length - MAX_ENTRIES);
  }
}

export function listAdminActions(): AdminAuditEntry[] {
  return [...entries].reverse();
}
