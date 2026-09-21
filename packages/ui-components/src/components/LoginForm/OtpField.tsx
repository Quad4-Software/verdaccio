import styled from '@emotion/styled';
import TextField from '@mui/material/TextField';
import type { FC } from 'react';
import React from 'react';
import type { FieldErrors } from 'react-hook-form';
import { useTranslation } from 'react-i18next';

import type { Theme } from '../../';
import type { LoginFormValues } from '../../utils/schemas';

const StyledTextField = styled(TextField)<{ theme?: Theme }>(({ theme }) => ({
  marginTop: theme.spacing(2),
}));

interface Props {
  register: any;
  errors: FieldErrors<LoginFormValues>;
}

const OtpField: FC<Props> = ({ register, errors }) => {
  const { t } = useTranslation();

  return (
    <StyledTextField
      autoComplete="one-time-code"
      error={!!errors.otp}
      fullWidth={true}
      helperText={
        errors.otp?.message ? t(errors.otp.message) : t('security.error.otp-required-help')
      }
      id="login--dialog-otp"
      inputProps={{ inputMode: 'numeric', pattern: '[0-9A-Za-z]*', maxLength: 64 }}
      {...register('otp')}
      data-testid="otp"
      label={t('security.tfa.enrol.code')}
      placeholder={t('security.tfa.enrol.code')}
      required={true}
      variant="outlined"
    />
  );
};

export default OtpField;
