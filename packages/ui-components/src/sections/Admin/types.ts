export interface AdminStatus {
  admin: boolean;
  userManagement: boolean;
}

export interface AdminUser {
  name: string;
  admin: boolean;
  tfa: boolean;
}

export interface AdminPackage {
  name: string;
  version?: string;
  visibility: 'public' | 'private';
}

export interface AdminMetrics {
  version: string;
  node: string;
  uptime: number;
  startedAt: string;
  memory: {
    rss: number;
    heapTotal: number;
    heapUsed: number;
  };
  counts: {
    packages: number;
    users: number | null;
  };
  requests: {
    total: number;
    byStatus: Record<string, number>;
  };
}

export interface AdminAuditEntry {
  time: string;
  actor: string;
  action: string;
  target?: string;
  detail?: string;
}
