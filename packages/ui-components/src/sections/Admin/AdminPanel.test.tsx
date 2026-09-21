import React from 'react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { getAdminState, resetAdminMock, setAdminStatus } from '../../../vitest/msw-utils';
import {
  act,
  cleanup,
  fireEvent,
  renderWithRouter,
  screen,
  waitFor,
} from '../../test/test-react-testing-library';
import { clearAuth, saveAuth } from '../../store/storage';
import { Route } from '../../utils';
import { generateTokenWithTimeRange } from '../../utils/token-generate';
import AdminPanel from './AdminPanel';

const mockNavigate = vi.fn();

vi.mock('react-router', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

const logIn = (username = 'admin') => saveAuth(username, generateTokenWithTimeRange(24));

const renderPanel = async () => {
  await act(async () => {
    renderWithRouter(<AdminPanel />, Route.ADMIN, [Route.ADMIN]);
  });
};

describe('<AdminPanel /> component', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockNavigate.mockClear();
    cleanup();
    clearAuth();
    resetAdminMock();
  });

  afterEach(() => {
    clearAuth();
  });

  test('redirects anonymous visitors home', async () => {
    await renderPanel();

    expect(mockNavigate).toHaveBeenCalledWith('/');
  });

  test('shows the forbidden message to non-admin users', async () => {
    logIn('worker');
    setAdminStatus(false);

    await renderPanel();

    await waitFor(() => {
      expect(screen.getByText('admin.error.not-admin')).toBeInTheDocument();
    });
  });

  test('renders metrics, users, packages and audit for an admin', async () => {
    logIn();

    await renderPanel();

    await waitFor(() => {
      expect(screen.getByTestId('admin-users-table')).toBeInTheDocument();
    });
    expect(screen.getByTestId('admin-packages-table')).toBeInTheDocument();
    expect(screen.getByTestId('admin-audit-table')).toBeInTheDocument();
    expect(screen.getByTestId('admin-user-admin')).toBeInTheDocument();
    expect(screen.getByTestId('admin-user-worker')).toBeInTheDocument();
    expect(screen.getByTestId('admin-package-secret-pkg')).toBeInTheDocument();
    expect(screen.getByText('user.create')).toBeInTheDocument();
  });

  test('hides the user section when the auth plugin cannot manage users', async () => {
    logIn();
    setAdminStatus(true, false);

    await renderPanel();

    await waitFor(() => {
      expect(screen.getByTestId('admin-packages-table')).toBeInTheDocument();
    });
    expect(screen.queryByTestId('admin-users-table')).not.toBeInTheDocument();
  });

  test('creates a user through the dialog', async () => {
    logIn();

    await renderPanel();

    await waitFor(() => {
      expect(screen.getByTestId('admin-create-user')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId('admin-create-user'));
    fireEvent.change(screen.getByTestId('admin-create-username').querySelector('input')!, {
      target: { value: 'newcomer' },
    });
    fireEvent.change(screen.getByTestId('admin-create-password').querySelector('input')!, {
      target: { value: 'a-long-enough-password' },
    });
    fireEvent.click(screen.getByTestId('admin-dialog-confirm'));

    await waitFor(() => {
      expect(screen.getByTestId('admin-user-newcomer')).toBeInTheDocument();
    });
    expect(getAdminState().users.map((u) => u.name)).toContain('newcomer');
  });

  test('grants admin rights to a user', async () => {
    logIn();

    await renderPanel();

    await waitFor(() => {
      expect(screen.getByTestId('admin-toggle-worker')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId('admin-toggle-worker'));

    await waitFor(() => {
      expect(getAdminState().users.find((u) => u.name === 'worker')?.admin).toBe(true);
    });
  });

  test('deletes a user after confirmation', async () => {
    logIn();

    await renderPanel();

    await waitFor(() => {
      expect(screen.getByTestId('admin-delete-worker')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId('admin-delete-worker'));
    fireEvent.click(screen.getByTestId('admin-dialog-confirm'));

    await waitFor(() => {
      expect(screen.queryByTestId('admin-user-worker')).not.toBeInTheDocument();
    });
  });

  test('does not offer deleting the current admin', async () => {
    logIn('admin');

    await renderPanel();

    await waitFor(() => {
      expect(screen.getByTestId('admin-delete-admin')).toBeDisabled();
    });
  });

  test('toggles a package between private and public', async () => {
    logIn();

    await renderPanel();

    await waitFor(() => {
      expect(screen.getByTestId('admin-visibility-toggle-secret-pkg')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId('admin-visibility-toggle-secret-pkg'));

    await waitFor(() => {
      expect(getAdminState().packages.find((p) => p.name === 'secret-pkg')?.visibility).toBe(
        'public'
      );
    });
  });
});
