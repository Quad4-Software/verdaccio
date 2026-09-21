import useSWR from 'swr';

import { getConfiguration } from '../../configuration';
import { useAuth } from '../../providers/AuthProvider';
import API from '../../store/api';
import { stripTrailingSlash } from '../../store/utils';
import { APIRoute } from '../../utils/routes';
import type { AdminAuditEntry, AdminMetrics, AdminPackage, AdminStatus, AdminUser } from './types';

function adminUrl(path = ''): string {
  const basePath = stripTrailingSlash(getConfiguration().base);
  return `${basePath}${APIRoute.ADMIN}${path}`;
}

/** Whether the logged in user may administer the registry. */
export function useAdminStatus() {
  const { userState } = useAuth();
  const url = userState?.token ? adminUrl('/status') : null;
  const { data, error, isLoading } = useSWR<AdminStatus>(url, () =>
    API.request<AdminStatus>(url as string)
  );

  return { status: data, error, isLoading };
}

function useAdminResource<T>(path: string, enabled: boolean) {
  const { userState } = useAuth();
  const url = enabled && userState?.token ? adminUrl(path) : null;
  const { data, error, isLoading, mutate } = useSWR<T>(url, () => API.request<T>(url as string));

  return { data, error, isLoading, mutate };
}

export function useAdminUsers(enabled: boolean) {
  return useAdminResource<{ users: AdminUser[] }>('/users', enabled);
}

export function useAdminPackages(enabled: boolean) {
  return useAdminResource<{ packages: AdminPackage[] }>('/packages', enabled);
}

export function useAdminMetrics(enabled: boolean) {
  return useAdminResource<AdminMetrics>('/metrics', enabled);
}

export function useAdminAudit(enabled: boolean) {
  return useAdminResource<{ audit: AdminAuditEntry[] }>('/audit', enabled);
}

export function createUser(username: string, password: string): Promise<{ success: boolean }> {
  return API.request<{ success: boolean }>(adminUrl('/users'), 'POST', {
    body: JSON.stringify({ username, password }),
    headers: { 'Content-Type': 'application/json' },
  });
}

export function deleteUser(user: string): Promise<{ success: boolean }> {
  return API.request<{ success: boolean }>(
    adminUrl(`/users/${encodeURIComponent(user)}`),
    'DELETE'
  );
}

export function setUserAdmin(user: string, admin: boolean): Promise<{ success: boolean }> {
  return API.request<{ success: boolean }>(
    adminUrl(`/users/${encodeURIComponent(user)}/admin`),
    'PUT',
    {
      body: JSON.stringify({ admin }),
      headers: { 'Content-Type': 'application/json' },
    }
  );
}

export function resetUserPassword(user: string, password: string): Promise<{ success: boolean }> {
  return API.request<{ success: boolean }>(
    adminUrl(`/users/${encodeURIComponent(user)}/password`),
    'PUT',
    {
      body: JSON.stringify({ password }),
      headers: { 'Content-Type': 'application/json' },
    }
  );
}

export function resetUserTfa(user: string): Promise<{ success: boolean }> {
  return API.request<{ success: boolean }>(
    adminUrl(`/users/${encodeURIComponent(user)}/tfa`),
    'DELETE'
  );
}

export function setPackageVisibility(
  name: string,
  visibility: 'public' | 'private'
): Promise<{ success: boolean }> {
  const path = name
    .split('/')
    .map((segment) => encodeURIComponent(segment).replace(/%40/g, '@'))
    .join('/');
  return API.request<{ success: boolean }>(adminUrl(`/packages/visibility/${path}`), 'PUT', {
    body: JSON.stringify({ visibility }),
    headers: { 'Content-Type': 'application/json' },
  });
}
