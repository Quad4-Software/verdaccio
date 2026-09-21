import {
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from '@mui/material';
import React, { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useAuth } from '../../providers/AuthProvider';
import type { AdminUser } from './types';
import {
  createUser,
  deleteUser,
  resetUserPassword,
  resetUserTfa,
  setUserAdmin,
  useAdminUsers,
} from './useAdmin';

type PendingAction =
  | { kind: 'delete'; user: string }
  | { kind: 'reset-tfa'; user: string }
  | { kind: 'reset-password'; user: string }
  | { kind: 'create' }
  | null;

const AdminUsers: React.FC = () => {
  const { t } = useTranslation();
  const { userState } = useAuth();
  const { data, error, mutate } = useAdminUsers(true);
  const [pending, setPending] = useState<PendingAction>(null);
  const [isBusy, setIsBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');

  const close = useCallback(() => {
    if (!isBusy) {
      setPending(null);
      setActionError(null);
      setUsername('');
      setPassword('');
    }
  }, [isBusy]);

  const run = useCallback(
    async (action: () => Promise<unknown>) => {
      setIsBusy(true);
      setActionError(null);
      try {
        await action();
        setPending(null);
        setUsername('');
        setPassword('');
        await mutate();
      } catch (err: any) {
        setActionError(err?.message ?? t('admin.error.action'));
      } finally {
        setIsBusy(false);
      }
    },
    [mutate, t]
  );

  const toggleAdmin = useCallback(
    (user: AdminUser) => run(() => setUserAdmin(user.name, !user.admin)),
    [run]
  );

  const confirm = useCallback(async () => {
    if (!pending) {
      return;
    }
    if (pending.kind === 'create') {
      await run(() => createUser(username, password));
    } else if (pending.kind === 'delete') {
      await run(() => deleteUser(pending.user));
    } else if (pending.kind === 'reset-tfa') {
      await run(() => resetUserTfa(pending.user));
    } else if (pending.kind === 'reset-password') {
      await run(() => resetUserPassword(pending.user, password));
    }
  }, [password, pending, run, username]);

  if (error) {
    return (
      <Paper sx={{ marginTop: 2, padding: 2 }} variant="outlined">
        <Typography color="error" role="alert">
          {t('admin.error.users')}
        </Typography>
      </Paper>
    );
  }

  const users = data?.users ?? [];

  return (
    <Paper sx={{ marginTop: 2, padding: 2 }} variant="outlined">
      <Box
        sx={{
          alignItems: 'center',
          display: 'flex',
          justifyContent: 'space-between',
        }}
      >
        <Typography component="h2" variant="h6">
          {t('admin.users.title')}
        </Typography>
        <Button
          data-testid="admin-create-user"
          onClick={() => setPending({ kind: 'create' })}
          size="small"
          variant="contained"
        >
          {t('admin.users.create')}
        </Button>
      </Box>
      <TableContainer sx={{ marginTop: 1, overflowX: 'auto' }}>
        <Table data-testid="admin-users-table" size="small">
          <TableHead>
            <TableRow>
              <TableCell>{t('admin.users.column.name')}</TableCell>
              <TableCell>{t('admin.users.column.admin')}</TableCell>
              <TableCell>{t('admin.users.column.tfa')}</TableCell>
              <TableCell align="right">{t('admin.users.column.actions')}</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {users.map((user) => (
              <TableRow data-testid={`admin-user-${user.name}`} hover={true} key={user.name}>
                <TableCell>{user.name}</TableCell>
                <TableCell>
                  {user.admin && <Chip label={t('admin.users.admin')} size="small" />}
                </TableCell>
                <TableCell>
                  {user.tfa && <Chip label={t('admin.users.tfa')} size="small" />}
                </TableCell>
                <TableCell align="right">
                  <Box
                    sx={{
                      display: 'flex',
                      gap: 1,
                      justifyContent: 'flex-end',
                    }}
                  >
                    <Button
                      data-testid={`admin-toggle-${user.name}`}
                      onClick={() => toggleAdmin(user)}
                      size="small"
                    >
                      {user.admin ? t('admin.users.revoke-admin') : t('admin.users.grant-admin')}
                    </Button>
                    <Button
                      data-testid={`admin-password-${user.name}`}
                      onClick={() => setPending({ kind: 'reset-password', user: user.name })}
                      size="small"
                    >
                      {t('admin.users.reset-password')}
                    </Button>
                    <Button
                      data-testid={`admin-tfa-${user.name}`}
                      disabled={!user.tfa}
                      onClick={() => setPending({ kind: 'reset-tfa', user: user.name })}
                      size="small"
                    >
                      {t('admin.users.reset-tfa')}
                    </Button>
                    <Button
                      color="error"
                      data-testid={`admin-delete-${user.name}`}
                      disabled={user.name === userState?.username}
                      onClick={() => setPending({ kind: 'delete', user: user.name })}
                      size="small"
                    >
                      {t('admin.users.delete')}
                    </Button>
                  </Box>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>

      <Dialog onClose={close} open={pending !== null}>
        <DialogTitle>
          {pending?.kind === 'create' && t('admin.users.create')}
          {pending?.kind === 'delete' && t('admin.users.confirm.delete-title')}
          {pending?.kind === 'reset-tfa' && t('admin.users.confirm.tfa-title')}
          {pending?.kind === 'reset-password' && t('admin.users.confirm.password-title')}
        </DialogTitle>
        <DialogContent>
          {pending?.kind === 'create' && (
            <>
              <TextField
                autoFocus={true}
                data-testid="admin-create-username"
                fullWidth={true}
                label={t('admin.users.field.username')}
                onChange={(event) => setUsername(event.target.value)}
                size="small"
                sx={{ marginTop: 1 }}
                value={username}
              />
              <TextField
                data-testid="admin-create-password"
                fullWidth={true}
                label={t('admin.users.field.password')}
                onChange={(event) => setPassword(event.target.value)}
                size="small"
                sx={{ marginTop: 1 }}
                type="password"
                value={password}
              />
            </>
          )}
          {pending?.kind === 'reset-password' && (
            <>
              <DialogContentText>
                {t('admin.users.confirm.password-body', { user: pending.user })}
              </DialogContentText>
              <TextField
                autoFocus={true}
                data-testid="admin-reset-password-input"
                fullWidth={true}
                label={t('admin.users.field.new-password')}
                onChange={(event) => setPassword(event.target.value)}
                size="small"
                sx={{ marginTop: 1 }}
                type="password"
                value={password}
              />
            </>
          )}
          {pending?.kind === 'delete' && (
            <DialogContentText>
              {t('admin.users.confirm.delete-body', { user: pending.user })}
            </DialogContentText>
          )}
          {pending?.kind === 'reset-tfa' && (
            <DialogContentText>
              {t('admin.users.confirm.tfa-body', { user: pending.user })}
            </DialogContentText>
          )}
          {actionError && (
            <Typography
              color="error"
              role="alert"
              sx={{
                marginTop: 2,
              }}
            >
              {actionError}
            </Typography>
          )}
        </DialogContent>
        <DialogActions>
          <Button disabled={isBusy} onClick={close}>
            {t('button.cancel')}
          </Button>
          <Button
            color={pending?.kind === 'delete' ? 'error' : 'primary'}
            data-testid="admin-dialog-confirm"
            disabled={
              isBusy ||
              (pending?.kind === 'create' && (username === '' || password === '')) ||
              (pending?.kind === 'reset-password' && password === '')
            }
            onClick={confirm}
            variant="contained"
          >
            {t('button.confirm')}
          </Button>
        </DialogActions>
      </Dialog>
    </Paper>
  );
};

export default AdminUsers;
