import { yupResolver } from '@hookform/resolvers/yup';
import { useCallback, useRef, useState } from 'react';
import { type UseFormReturn, useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';

import { useAuth } from '../../providers/AuthProvider';
import { authErrorMessage } from '../../providers/AuthProvider/utils';
import type { LoginFormValues } from '../../utils/schemas';
import { loginSchema } from '../../utils/schemas';

type Options = {
  onSuccess?: () => void;
};

export function useLoginForm({ onSuccess }: Options = {}): UseFormReturn<LoginFormValues> & {
  onSubmit: (data: LoginFormValues) => Promise<void>;
  otpRequired: boolean;
} {
  const { handleLogin } = useAuth();
  const { t } = useTranslation();
  const [otpRequired, setOtpRequired] = useState(false);

  const form = useForm<LoginFormValues>({
    mode: 'onChange',
    resolver: yupResolver(loginSchema),
  });

  const { setError } = form;

  // `disabled={isSubmitting}` only applies after a re-render; clicks landing in
  // the same React batch would still fire duplicate requests
  const inFlight = useRef(false);

  const onSubmit = useCallback(
    async (data: LoginFormValues) => {
      if (inFlight.current) {
        return;
      }
      inFlight.current = true;
      try {
        await handleLogin?.(data);
        onSuccess?.();
      } catch (err: any) {
        // a two-factor challenge is not a failure — reveal the OTP field and
        // let the user retry with the code from their authenticator
        if (err?.otpRequired === true) {
          setOtpRequired(true);
          setError('root', {
            type: 'server',
            message: t('security.error.otp-required'),
          });
          return;
        }
        // only a 401 means wrong credentials; a dead server, 500 or 429 must
        // not claim the credentials were invalid
        const message =
          err?.code === 401
            ? t('security.error.invalid-credentials')
            : authErrorMessage(err, t('security.error.unable-to-login'));
        setError('root', { type: 'server', message });
      } finally {
        inFlight.current = false;
      }
    },
    [handleLogin, setError, onSuccess, t]
  );

  return {
    ...form,
    onSubmit,
    otpRequired,
  };
}
