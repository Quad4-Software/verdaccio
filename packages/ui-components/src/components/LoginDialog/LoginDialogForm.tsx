import type { FC } from 'react';
import React from 'react';

import LoginForm from '../LoginForm/Login';
import { useLoginForm } from '../LoginForm/useLoginForm';

const LoginDialogForm: FC = () => {
  const {
    register,
    handleSubmit,
    formState: { isValid, isSubmitting, errors },
    onSubmit,
    otpRequired,
  } = useLoginForm();
  return (
    <LoginForm
      errors={errors}
      handleSubmit={handleSubmit}
      isSubmitting={isSubmitting}
      isValid={isValid}
      onSubmit={onSubmit}
      otpRequired={otpRequired}
      register={register}
    />
  );
};

export default LoginDialogForm;
