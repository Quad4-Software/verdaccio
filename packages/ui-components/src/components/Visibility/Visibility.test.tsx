import React from 'react';
import { beforeEach, describe, expect, test, vi } from 'vitest';

import { getLastVisibilityBody, resetVisibilityMock } from '../../../vitest/msw-utils';
import { VersionProvider } from '../../providers';
import { act, renderWithRouteDetail, screen, waitFor } from '../../test/test-react-testing-library';
import Visibility from './Visibility';

let session: { token: string | null; username: string | null } = {
  token: 'a-session-token',
  username: 'jota',
};

// the render helper mounts the real provider, so it has to stay exported
vi.mock('../../providers/AuthProvider', () => ({
  AuthProvider: ({ children }: { children: React.ReactNode }) => children,
  useAuth: () => ({ userState: session }),
}));

vi.mock('marked');
vi.mock('marked-highlight');

const Component: React.FC = () => (
  <VersionProvider>
    <Visibility />
  </VersionProvider>
);

describe('Visibility', () => {
  beforeEach(() => {
    session = { token: 'a-session-token', username: 'jota' };
    resetVisibilityMock();
  });

  test('renders nothing when the user is not logged in', async () => {
    session = { token: null, username: null };
    await act(async () => {
      renderWithRouteDetail(<Component />, 'jquery');
    });
    await waitFor(() => expect(screen.queryByTestId('visibility-chip')).not.toBeInTheDocument());
  });

  test('shows the public state and a make private action', async () => {
    await act(async () => {
      renderWithRouteDetail(<Component />, 'jquery');
    });
    await waitFor(() => expect(screen.getByTestId('visibility-chip')).toBeInTheDocument());
    expect(screen.getByTestId('visibility-toggle')).toBeInTheDocument();
  });

  test('sends the private flag when toggling', async () => {
    await act(async () => {
      renderWithRouteDetail(<Component />, 'jquery');
    });
    const toggle = await screen.findByTestId('visibility-toggle');
    await act(async () => {
      toggle.click();
    });
    await waitFor(() => expect(getLastVisibilityBody()).toEqual({ visibility: 'private' }));
  });
});
