import { yupResolver } from '@hookform/resolvers/yup';
import { Button, FormControlLabel, Radio, RadioGroup, Typography } from '@mui/material';
import QRCode from 'qrcode';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';

import { useData } from '../../api/use-data';
import { useDataMutation } from '../../api/use-data-mutation';
import CopyToClipBoard from '../../components/CopyClipboard/CopyToClipBoard';
import LoginDialogFormError from '../../components/LoginDialog/LoginDialogFormError';
import { getConfiguration } from '../../configuration';
import SecurityLayout from '../../layouts/Security/Dialog';
import { useAuth } from '../../providers/AuthProvider';
import { authErrorMessage } from '../../providers/AuthProvider/utils';
import { stripTrailingSlash } from '../../store/utils';
import { Route } from '../../utils';
import { APIRoute } from '../../utils/routes';
import type { TfaEnableFormValues, TfaVerifyFormValues } from '../../utils/schemas';
import { tfaEnableSchema, tfaVerifySchema } from '../../utils/schemas';
import { SecurityContainer, SecurityForm, SecurityTextField } from './styles';

type TfaStatus = false | { mode: 'auth-only' | 'auth-and-writes'; pending: boolean };

interface Profile {
  name: string;
  tfa: TfaStatus;
}

/** otpauth:// URIs carry the shared secret as a query parameter. */
function secretFromOtpauthUrl(otpauthUrl: string): string {
  try {
    return new URL(otpauthUrl).searchParams.get('secret') ?? '';
  } catch {
    return '';
  }
}

const TwoFactorAuth: React.FC = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const configuration = getConfiguration();
  const basePath = stripTrailingSlash(configuration.base);
  const tfaEnabled = configuration?.flags?.tfa;
  const { userState } = useAuth();
  const isLoggedIn = typeof userState?.username === 'string';

  const { data: profile, isLoading, mutate } = useData<Profile>(basePath, APIRoute.PROFILE);
  const { trigger } = useDataMutation<{ tfa: string | string[] }>(
    basePath,
    APIRoute.PROFILE,
    'POST'
  );

  // 'enrol' shows the QR step, 'codes' the one-time recovery codes
  const [step, setStep] = useState<'status' | 'enrol' | 'codes'>('status');
  const [otpauthUrl, setOtpauthUrl] = useState<string>();
  const [qrDataUrl, setQrDataUrl] = useState<string>();
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>();

  const enableForm = useForm<TfaEnableFormValues>({
    mode: 'onChange',
    defaultValues: { password: '', mode: 'auth-only' },
    resolver: yupResolver(tfaEnableSchema),
  });
  const verifyForm = useForm<TfaVerifyFormValues>({
    mode: 'onChange',
    defaultValues: { code: '' },
    resolver: yupResolver(tfaVerifySchema),
  });
  const inFlight = useRef(false);

  const onEnable = useCallback(
    async (data: TfaEnableFormValues) => {
      if (inFlight.current) {
        return;
      }
      inFlight.current = true;
      try {
        const result = await trigger({ tfa: { mode: data.mode, password: data.password } });
        const uri = result?.tfa;
        if (typeof uri !== 'string') {
          throw new Error('missing otpauth uri');
        }
        setOtpauthUrl(uri);
        setQrDataUrl(await QRCode.toDataURL(uri, { margin: 1, width: 220 }));
        setStep('enrol');
      } catch (err) {
        enableForm.setError('root', {
          type: 'server',
          message: authErrorMessage(err, t('security.tfa.error.unable-to-enable')),
        });
      } finally {
        inFlight.current = false;
      }
    },
    [trigger, enableForm, t]
  );

  const onVerify = useCallback(
    async (data: TfaVerifyFormValues) => {
      if (inFlight.current) {
        return;
      }
      inFlight.current = true;
      try {
        const result = await trigger({ tfa: [data.code] });
        if (!Array.isArray(result?.tfa)) {
          throw new Error('missing recovery codes');
        }
        setRecoveryCodes(result.tfa);
        setStep('codes');
      } catch (err) {
        verifyForm.setError('root', {
          type: 'server',
          message: authErrorMessage(err, t('security.tfa.error.invalid-code')),
        });
      } finally {
        inFlight.current = false;
      }
    },
    [trigger, verifyForm, t]
  );

  const onDisable = useCallback(
    async (data: TfaEnableFormValues) => {
      if (inFlight.current) {
        return;
      }
      inFlight.current = true;
      try {
        await trigger({ tfa: { mode: 'disable', password: data.password } });
        await mutate();
        setStep('status');
      } catch (err) {
        enableForm.setError('root', {
          type: 'server',
          message: authErrorMessage(err, t('security.tfa.error.unable-to-disable')),
        });
      } finally {
        inFlight.current = false;
      }
    },
    [trigger, mutate, enableForm, t]
  );

  useEffect(() => {
    if (!tfaEnabled) {
      navigate('/');
    }
  }, [tfaEnabled, navigate]);

  if (!tfaEnabled) {
    return null;
  }

  const tfa = profile?.tfa;
  const isEnabled = typeof tfa === 'object' && tfa !== null && tfa.pending === false;

  // handleSubmit must be invoked at submit time, not during render
  const submitVerify = (event: React.BaseSyntheticEvent) =>
    verifyForm.handleSubmit(onVerify)(event);
  const submitEnable = (event: React.BaseSyntheticEvent) =>
    enableForm.handleSubmit(isEnabled ? onDisable : onEnable)(event);

  return (
    <SecurityLayout>
      <SecurityContainer>
        {step === 'codes' && recoveryCodes ? (
          <SecurityForm onSubmit={(event) => event.preventDefault()}>
            <Typography align="center" component="h1" gutterBottom={true} variant="h4">
              {t('security.tfa.recoveryCodes.title')}
            </Typography>
            <Typography align="center" variant="body2">
              {t('security.tfa.recoveryCodes.description')}
            </Typography>
            <CopyToClipBoard
              dataTestId="tfa-recovery-codes-copy"
              text={recoveryCodes.join('\n')}
              title={t('copy-to-clipboard')}
            >
              <span data-testid="tfa-recovery-codes">{recoveryCodes.join('\n')}</span>
            </CopyToClipBoard>
            <Button
              color="primary"
              fullWidth={true}
              onClick={() => {
                setStep('status');
                mutate();
              }}
              sx={{ mt: 2 }}
              variant="contained"
            >
              {t('security.tfa.recoveryCodes.done')}
            </Button>
          </SecurityForm>
        ) : step === 'enrol' && otpauthUrl ? (
          <SecurityForm onSubmit={submitVerify}>
            <Typography align="center" component="h1" gutterBottom={true} variant="h4">
              {t('security.tfa.enrol.title')}
            </Typography>
            <Typography align="center" variant="body2">
              {t('security.tfa.enrol.scanQr')}
            </Typography>
            {qrDataUrl && (
              <img
                alt={t('security.tfa.enrol.qrAlt')}
                data-testid="tfa-qr"
                src={qrDataUrl}
                style={{ display: 'block', margin: '0 auto' }}
              />
            )}
            <Typography align="center" variant="body2">
              {t('security.tfa.enrol.manualKey')}
            </Typography>
            <Typography
              align="center"
              data-testid="tfa-secret"
              sx={{ wordBreak: 'break-all' }}
              variant="caption"
            >
              {secretFromOtpauthUrl(otpauthUrl)}
            </Typography>
            <SecurityTextField
              error={!!verifyForm.formState.errors.code}
              helperText={verifyForm.formState.errors.code?.message}
              slotProps={{
                htmlInput: { autoComplete: 'one-time-code', inputMode: 'numeric' },
              }}
              label={t('security.tfa.enrol.code')}
              {...verifyForm.register('code')}
              required={true}
            />
            {verifyForm.formState.errors.root && (
              <LoginDialogFormError error={verifyForm.formState.errors.root} />
            )}
            <Button
              color="primary"
              disabled={!verifyForm.formState.isValid || verifyForm.formState.isSubmitting}
              fullWidth={true}
              sx={{ mt: 2 }}
              type="submit"
              variant="contained"
            >
              {t('security.tfa.enrol.verify')}
            </Button>
          </SecurityForm>
        ) : (
          <SecurityForm onSubmit={submitEnable}>
            <Typography align="center" component="h1" gutterBottom={true} variant="h4">
              {t('security.tfa.title')}
            </Typography>
            {!isLoggedIn ? (
              <>
                <Typography align="center" variant="body2">
                  {t('security.tfa.mustBeLoggedIn')}
                </Typography>
                <Button
                  color="primary"
                  fullWidth={true}
                  onClick={() => navigate(Route.LOGIN)}
                  sx={{ mt: 2 }}
                  variant="contained"
                >
                  {t('security.tfa.login')}
                </Button>
              </>
            ) : isLoading ? null : isEnabled ? (
              <>
                <Typography align="center" data-testid="tfa-status-enabled" variant="body2">
                  {t('security.tfa.status.enabled', {
                    mode: t(`security.tfa.mode.${tfa.mode}`),
                  })}
                </Typography>
                <SecurityTextField
                  error={!!enableForm.formState.errors.password}
                  helperText={enableForm.formState.errors.password?.message}
                  label={t('security.tfa.password')}
                  {...enableForm.register('password')}
                  required={true}
                  type="password"
                />
                {enableForm.formState.errors.root && (
                  <LoginDialogFormError error={enableForm.formState.errors.root} />
                )}
                <Button
                  color="primary"
                  disabled={!enableForm.formState.isValid || enableForm.formState.isSubmitting}
                  fullWidth={true}
                  sx={{ mt: 2 }}
                  type="submit"
                  variant="contained"
                >
                  {t('security.tfa.disable')}
                </Button>
              </>
            ) : (
              <>
                <Typography align="center" variant="body2">
                  {t('security.tfa.description')}
                </Typography>
                {typeof tfa === 'object' && tfa?.pending === true && (
                  <Typography align="center" data-testid="tfa-pending-notice" variant="body2">
                    {t('security.tfa.status.pending')}
                  </Typography>
                )}
                <RadioGroup
                  defaultValue="auth-only"
                  onChange={(event) =>
                    enableForm.setValue('mode', event.target.value as TfaEnableFormValues['mode'], {
                      shouldValidate: true,
                    })
                  }
                >
                  <FormControlLabel
                    control={<Radio />}
                    label={t('security.tfa.mode.auth-only')}
                    value="auth-only"
                  />
                  <FormControlLabel
                    control={<Radio />}
                    label={t('security.tfa.mode.auth-and-writes')}
                    value="auth-and-writes"
                  />
                </RadioGroup>
                <SecurityTextField
                  error={!!enableForm.formState.errors.password}
                  helperText={enableForm.formState.errors.password?.message}
                  label={t('security.tfa.password')}
                  {...enableForm.register('password')}
                  required={true}
                  type="password"
                />
                {enableForm.formState.errors.root && (
                  <LoginDialogFormError error={enableForm.formState.errors.root} />
                )}
                <Button
                  color="primary"
                  disabled={!enableForm.formState.isValid || enableForm.formState.isSubmitting}
                  fullWidth={true}
                  sx={{ mt: 2 }}
                  type="submit"
                  variant="contained"
                >
                  {t('security.tfa.enable')}
                </Button>
              </>
            )}
          </SecurityForm>
        )}
      </SecurityContainer>
    </SecurityLayout>
  );
};

export default TwoFactorAuth;
