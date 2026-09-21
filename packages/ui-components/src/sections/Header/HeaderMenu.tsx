import AccountCircle from '@mui/icons-material/AccountCircle';
import IconButton from '@mui/material/IconButton';
import Menu from '@mui/material/Menu';
import type { MouseEvent } from 'react';
import React from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';

import { MenuItem } from '../../';
import { useConfig } from '../../providers/AppConfigurationProvider/AppConfigurationProvider';
import { useAdminStatus } from '../../sections/Admin/useAdmin';
import { Route } from '../../utils';
import HeaderGreetings from './HeaderGreetings';

// Workaround: MUI MenuProps type resolution breaks inherited PopoverProps.
const TypedMenu = Menu as React.FC<any>;

interface Props {
  username: string;
  isMenuOpen: boolean;
  anchorEl?: Element | null | undefined;
  onLogout: () => void;
  onLoggedInMenu: (event: MouseEvent<HTMLButtonElement>) => void;
  onLoggedInMenuClose: () => void;
}

const HeaderMenu: React.FC<Props> = ({
  onLogout,
  username,
  isMenuOpen = false,
  anchorEl,
  onLoggedInMenu,
  onLoggedInMenuClose,
}) => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { configOptions } = useConfig();
  const stageEnabled = configOptions?.flags?.stage;
  const tfaEnabled = configOptions?.flags?.tfa;
  // one extra request per session decides whether the admin entry renders
  const { status } = useAdminStatus();
  return (
    <>
      <IconButton
        color="inherit"
        data-testid="logInDialogIcon"
        id="header--button-account"
        onClick={onLoggedInMenu}
        size="large"
      >
        <AccountCircle />
      </IconButton>
      <TypedMenu
        anchorEl={anchorEl}
        anchorOrigin={{
          vertical: 'bottom',
          horizontal: 'right',
        }}
        onClose={onLoggedInMenuClose}
        open={isMenuOpen}
        transformOrigin={{
          vertical: 'top',
          horizontal: 'right',
        }}
      >
        <MenuItem>
          <HeaderGreetings username={username} />
        </MenuItem>
        {stageEnabled && (
          <MenuItem
            data-testid="stagedPackagesMenuItem"
            id="stagedPackagesMenuItem"
            onClick={() => {
              onLoggedInMenuClose();
              navigate(Route.STAGE);
            }}
          >
            {t('stage.menu')}
          </MenuItem>
        )}
        {tfaEnabled && (
          <MenuItem
            data-testid="twoFactorMenuItem"
            id="twoFactorMenuItem"
            onClick={() => {
              onLoggedInMenuClose();
              navigate(Route.TWO_FACTOR);
            }}
          >
            {t('security.tfa.menu')}
          </MenuItem>
        )}
        {status?.admin === true && (
          <MenuItem
            data-testid="adminMenuItem"
            id="adminMenuItem"
            onClick={() => {
              onLoggedInMenuClose();
              navigate(Route.ADMIN);
            }}
          >
            {t('admin.menu')}
          </MenuItem>
        )}
        <MenuItem data-testid="logOutDialogIcon" id="logOutDialogIcon" onClick={onLogout}>
          {t('button.logout')}
        </MenuItem>
      </TypedMenu>
    </>
  );
};

export default HeaderMenu;
