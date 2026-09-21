import { yupResolver } from '@hookform/resolvers/yup';
import { Button, Typography } from '@mui/material';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';

import { fetcher, useDataMutation } from '../../api/use-data-mutation';
import LoginDialogFormError from '../../components/LoginDialog/LoginDialogFormError';
import { getConfiguration } from '../../configuration';
import SecurityLayout from '../../layouts/Security/Dialog';
import { useAuth } from '../../providers/AuthProvider/AuthProvider';
import { authErrorMessage } from '../../providers/AuthProvider/utils';
import { saveAuth } from '../../store/storage';
import { stripTrailingSlash } from '../../store/utils';
import { Route } from '../../utils';
import { APIRoute } from '../../utils/routes';
import type { SetupAdminFormValues } from '../../utils/schemas';
import { SETUP_PASSWORD_MIN_LENGTH, setupAdminSchema } from '../../utils/schemas';
import { MessageType } from './Success';
import { SecurityContainer, SecurityForm, SecurityTextField } from './styles';

type SetupStatus = {
  ok?: boolean;
  expires?: number;
};

type SetupSession = {
  token?: string;
  username?: string;
};

function readSetupToken(): string {
  const raw = window.location.hash.replace(/^#/, '');
  if (!raw) {
    return '';
  }
  try {
    return decodeURIComponent(raw);
  } catch {
    return '';
  }
}

function formatRemaining(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

const SetupAdmin: React.FC = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { setUserState } = useAuth();
  const configuration = getConfiguration();
  const basePath = stripTrailingSlash(configuration.base);
  const [token] = useState(readSetupToken);
  const [expires, setExpires] = useState<number | null>(null);
  const [now, setNow] = useState(Date.now());
  const [linkError, setLinkError] = useState('');
  const inFlight = useRef(false);

  const create = useDataMutation<SetupSession>(basePath, APIRoute.SETUP, 'POST');

  const form = useForm<SetupAdminFormValues>({
    mode: 'onChange',
    defaultValues: { username: '', password: '', confirmPassword: '' },
    resolver: yupResolver(setupAdminSchema),
  });

  const {
    setError,
    handleSubmit,
    register,
    formState: { isValid, isSubmitting, errors },
  } = form;

  useEffect(() => {
    if (!token) {
      setLinkError(t('security.setup.missing'));
      return;
    }
    let cancelled = false;
    fetcher<SetupStatus>(`${basePath}${APIRoute.SETUP_STATUS}`, 'POST', { token })
      .then((result) => {
        if (cancelled) {
          return;
        }
        if (!result?.expires) {
          setLinkError(t('security.setup.expired'));
          return;
        }
        setExpires(result.expires);
      })
      .catch((err) => {
        if (!cancelled) {
          setLinkError(authErrorMessage(err, t('security.setup.expired')));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [basePath, token, t]);

  useEffect(() => {
    if (!expires) {
      return;
    }
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [expires]);

  const remaining = expires ? Math.max(0, expires - now) : 0;
  const expired = Boolean(expires && remaining === 0);
  const linkReady = Boolean(token && expires && remaining > 0 && !linkError);

  const onSubmit = useCallback(
    async (data: SetupAdminFormValues) => {
      if (inFlight.current || !token) {
        return;
      }
      inFlight.current = true;
      try {
        const result = await create.trigger({
          token,
          username: data.username,
          password: data.password,
        });
        if (!result?.username || !result.token) {
          throw new Error('setup response is missing the token');
        }
        saveAuth(result.username, result.token);
        setUserState?.({ username: result.username, token: result.token });
        navigate(
          {
            pathname: Route.SUCCESS,
            search: `?messageType=${MessageType.SetupAdmin}`,
            hash: '',
          },
          { replace: true }
        );
      } catch (err) {
        setError('root', {
          type: 'server',
          message: authErrorMessage(err, t('security.setup.expired')),
        });
      } finally {
        inFlight.current = false;
      }
    },
    [create, navigate, setError, setUserState, t, token]
  );

  return (
    <SecurityLayout>
      <SecurityContainer>
        <SecurityForm onSubmit={handleSubmit(onSubmit)}>
          <Typography align="center" component="h1" gutterBottom={true} variant="h4">
            {t('security.setup.title')}
          </Typography>
          <Typography color="text.secondary" paragraph={true} sx={{ fontSize: 14 }} variant="body2">
            {t('security.setup.description')}
          </Typography>
          {linkReady && (
            <Typography align="center" sx={{ mb: 1 }} variant="body2">
              {t('security.setup.expires', { time: formatRemaining(remaining) })}
            </Typography>
          )}
          {(linkError || expired) && (
            <Typography color="error" paragraph={true} variant="body2">
              {linkError || t('security.setup.expired')}
            </Typography>
          )}
          <SecurityTextField
            autoComplete="username"
            disabled={!linkReady}
            error={!!errors.username}
            helperText={errors.username?.message ? t(errors.username.message) : undefined}
            label={t('form.username')}
            {...register('username')}
          />
          <SecurityTextField
            autoComplete="new-password"
            disabled={!linkReady}
            error={!!errors.password}
            helperText={
              errors.password?.message
                ? t(errors.password.message, { length: SETUP_PASSWORD_MIN_LENGTH })
                : undefined
            }
            label={t('security.setup.password')}
            type="password"
            {...register('password')}
          />
          <SecurityTextField
            autoComplete="new-password"
            disabled={!linkReady}
            error={!!errors.confirmPassword}
            helperText={
              errors.confirmPassword?.message ? t(errors.confirmPassword.message) : undefined
            }
            label={t('security.setup.confirmPassword')}
            type="password"
            {...register('confirmPassword')}
          />
          {errors.root && <LoginDialogFormError error={errors.root} />}
          <Button
            color="primary"
            disabled={!linkReady || !isValid || isSubmitting}
            fullWidth={true}
            sx={{ mt: 2 }}
            type="submit"
            variant="contained"
          >
            {t('security.setup.submit')}
          </Button>
        </SecurityForm>
      </SecurityContainer>
    </SecurityLayout>
  );
};

export default SetupAdmin;
