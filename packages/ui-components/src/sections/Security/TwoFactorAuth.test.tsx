import React from 'react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { resetProfileMock } from '../../../vitest/msw-utils';
import {
  act,
  cleanup,
  fireEvent,
  renderWithRouter,
  screen,
  waitFor,
} from '../../test/test-react-testing-library';
import { saveAuth, clearAuth } from '../../store/storage';
import { Route } from '../../utils';
import { generateTokenWithTimeRange } from '../../utils/token-generate';
import TwoFactorAuth from './TwoFactorAuth';

const mockNavigate = vi.fn();

vi.mock('react-router', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

const enableFlag = () => {
  window.__VERDACCIO_BASENAME_UI_OPTIONS = {
    ...window.__VERDACCIO_BASENAME_UI_OPTIONS,
    flags: { tfa: true },
  };
};

const logIn = () => saveAuth('testuser', generateTokenWithTimeRange(24));

describe('<TwoFactorAuth /> component', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.resetAllMocks();
    mockNavigate.mockClear();
    cleanup();
    clearAuth();
    resetProfileMock();
  });

  afterEach(() => {
    clearAuth();
    // @ts-ignore
    delete window.__VERDACCIO_BASENAME_UI_OPTIONS.flags;
  });

  test('redirects to home when the tfa flag is disabled', async () => {
    window.__VERDACCIO_BASENAME_UI_OPTIONS = {
      ...window.__VERDACCIO_BASENAME_UI_OPTIONS,
      flags: { tfa: false },
    };

    await act(async () => {
      renderWithRouter(<TwoFactorAuth />, Route.TWO_FACTOR, [Route.TWO_FACTOR]);
    });

    expect(mockNavigate).toHaveBeenCalledWith('/');
  });

  test('asks for a login when there is no session', async () => {
    enableFlag();

    await act(async () => {
      renderWithRouter(<TwoFactorAuth />, Route.TWO_FACTOR, [Route.TWO_FACTOR]);
    });

    expect(screen.getByText('security.tfa.mustBeLoggedIn')).toBeInTheDocument();
  });

  test('shows the enrolment form when two-factor is off', async () => {
    enableFlag();
    logIn();

    await act(async () => {
      renderWithRouter(<TwoFactorAuth />, Route.TWO_FACTOR, [Route.TWO_FACTOR]);
    });

    await waitFor(() => {
      expect(screen.getByText('security.tfa.description')).toBeInTheDocument();
    });
    expect(screen.getByLabelText(/security.tfa.password/)).toBeInTheDocument();
  });

  test('enrols: password, QR step, code, then recovery codes', async () => {
    enableFlag();
    logIn();

    await act(async () => {
      renderWithRouter(<TwoFactorAuth />, Route.TWO_FACTOR, [Route.TWO_FACTOR]);
    });

    await waitFor(() => {
      expect(screen.getByLabelText(/security.tfa.password/)).toBeInTheDocument();
    });

    await act(async () => {
      fireEvent.change(screen.getByLabelText(/security.tfa.password/), {
        target: { value: 'hunter2' },
      });
    });

    const enableButton = screen.getByRole('button', {
      name: 'security.tfa.enable',
    });
    await waitFor(() => expect(enableButton).not.toBeDisabled());
    await act(async () => {
      fireEvent.click(enableButton);
    });

    await waitFor(() => {
      expect(screen.getByTestId('tfa-qr')).toBeInTheDocument();
    });
    expect(screen.getByText(/JBSWY3DPEHPK3PXP/)).toBeInTheDocument();

    await act(async () => {
      fireEvent.change(screen.getByLabelText(/security.tfa.enrol.code/), {
        target: { value: '123456' },
      });
    });

    const verifyButton = screen.getByRole('button', { name: 'security.tfa.enrol.verify' });
    await waitFor(() => expect(verifyButton).not.toBeDisabled());
    await act(async () => {
      fireEvent.click(verifyButton);
    });

    await waitFor(() => {
      expect(screen.getByTestId('tfa-recovery-codes')).toBeInTheDocument();
    });
    expect(screen.getByText(/recovery-code-1/)).toBeInTheDocument();
  });

  test('shows an error when the verification code is wrong', async () => {
    enableFlag();
    logIn();

    await act(async () => {
      renderWithRouter(<TwoFactorAuth />, Route.TWO_FACTOR, [Route.TWO_FACTOR]);
    });

    await waitFor(() => {
      expect(screen.getByLabelText(/security.tfa.password/)).toBeInTheDocument();
    });

    await act(async () => {
      fireEvent.change(screen.getByLabelText(/security.tfa.password/), {
        target: { value: 'hunter2' },
      });
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'security.tfa.enable' }));
    });
    await waitFor(() => {
      expect(screen.getByLabelText(/security.tfa.enrol.code/)).toBeInTheDocument();
    });

    await act(async () => {
      fireEvent.change(screen.getByLabelText(/security.tfa.enrol.code/), {
        target: { value: '000000' },
      });
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'security.tfa.enrol.verify' }));
    });

    await waitFor(() => {
      expect(screen.getByText('invalid one-time password')).toBeInTheDocument();
    });
  });

  test('rejects a non-numeric code client-side', async () => {
    enableFlag();
    logIn();

    await act(async () => {
      renderWithRouter(<TwoFactorAuth />, Route.TWO_FACTOR, [Route.TWO_FACTOR]);
    });
    await waitFor(() => {
      expect(screen.getByLabelText(/security.tfa.password/)).toBeInTheDocument();
    });
    await act(async () => {
      fireEvent.change(screen.getByLabelText(/security.tfa.password/), {
        target: { value: 'hunter2' },
      });
    });
    const enableButton = screen.getByRole('button', { name: 'security.tfa.enable' });
    await waitFor(() => expect(enableButton).not.toBeDisabled());
    await act(async () => {
      fireEvent.click(enableButton);
    });
    await waitFor(() => {
      expect(screen.getByLabelText(/security.tfa.enrol.code/)).toBeInTheDocument();
    });

    await act(async () => {
      fireEvent.change(screen.getByLabelText(/security.tfa.enrol.code/), {
        target: { value: 'abcdef' },
      });
    });

    await waitFor(() => {
      expect(screen.getByText('security.tfa.error.code-format')).toBeInTheDocument();
    });
  });
});
