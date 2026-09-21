import Button from '@mui/material/Button';
import Divider from '@mui/material/Divider';
import type { FC } from 'react';
import React from 'react';
import { useTranslation } from 'react-i18next';

import { useData } from '../../api/use-data';
import { getConfiguration } from '../../configuration';
import { stripTrailingSlash } from '../../store/utils';
import { APIRoute } from '../../utils/routes';

interface OidcConfigResponse {
  enabled: boolean;
  loginButtonText?: string;
  authorize: string;
}

interface Props {
  /**
   * Where the oauth callback continues after sign-in: the CLI login session
   * path on the security page, the current location on the header dialog.
   */
  next?: string;
}

const OidcLoginButton: FC<Props> = ({ next }) => {
  const { t } = useTranslation();
  const configuration = getConfiguration();
  const basePath = stripTrailingSlash(configuration.base);
  const { data, error } = useData<OidcConfigResponse>(basePath, APIRoute.OIDC_CONFIG);

  if (error || !data?.enabled) {
    return null;
  }

  const target = next ?? `${window.location.pathname}${window.location.search}`;
  const href = `${basePath}${data.authorize}?next=${encodeURIComponent(target)}`;

  return (
    <>
      <Divider sx={{ my: 2 }}>{t('security.login.or')}</Divider>
      <Button
        component="a"
        data-testid="login-sso-button"
        fullWidth={true}
        href={href}
        size="large"
        variant="outlined"
      >
        {data.loginButtonText ?? t('security.login.loginWithSso')}
      </Button>
    </>
  );
};

export default OidcLoginButton;
