import { Box, CircularProgress, Typography } from '@mui/material';
import React from 'react';
import { useTranslation } from 'react-i18next';

import { useRequireSession } from '../Stage/useRequireSession';
import AdminAudit from './AdminAudit';
import AdminMetrics from './AdminMetrics';
import AdminPackages from './AdminPackages';
import AdminUsers from './AdminUsers';
import { useAdminStatus } from './useAdmin';

const AdminPanel: React.FC = () => {
  const { t } = useTranslation();
  const isLoggedIn = useRequireSession();
  const { status, error, isLoading } = useAdminStatus();

  if (!isLoggedIn) {
    return null;
  }

  if (isLoading) {
    return (
      <Box
        sx={{
          display: 'flex',
          justifyContent: 'center',
          padding: 4,
        }}
      >
        <CircularProgress />
      </Box>
    );
  }

  if (error || !status?.admin) {
    return (
      <Box
        sx={{
          padding: 2,
        }}
      >
        <Typography color="error" role="alert">
          {t('admin.error.not-admin')}
        </Typography>
      </Box>
    );
  }

  return (
    <Box
      sx={{
        padding: 2,
      }}
    >
      <Typography component="h1" gutterBottom={true} variant="h5">
        {t('admin.title')}
      </Typography>
      <AdminMetrics />
      {status.userManagement && <AdminUsers />}
      <AdminPackages />
      <AdminAudit />
    </Box>
  );
};

export default AdminPanel;
