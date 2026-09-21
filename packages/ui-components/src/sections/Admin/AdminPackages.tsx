import {
  Button,
  Chip,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material';
import React, { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { setPackageVisibility, useAdminPackages } from './useAdmin';

const AdminPackages: React.FC = () => {
  const { t } = useTranslation();
  const { data, error, mutate } = useAdminPackages(true);
  const [busyPackage, setBusyPackage] = useState<string | null>(null);
  const [actionError, setActionError] = useState(false);

  const toggle = useCallback(
    async (name: string, visibility: 'public' | 'private') => {
      setBusyPackage(name);
      setActionError(false);
      try {
        await setPackageVisibility(name, visibility === 'private' ? 'public' : 'private');
        await mutate();
      } catch {
        setActionError(true);
      } finally {
        setBusyPackage(null);
      }
    },
    [mutate]
  );

  if (error) {
    return (
      <Paper sx={{ marginTop: 2, padding: 2 }} variant="outlined">
        <Typography color="error" role="alert">
          {t('admin.error.packages')}
        </Typography>
      </Paper>
    );
  }

  const packages = data?.packages ?? [];

  return (
    <Paper sx={{ marginTop: 2, padding: 2 }} variant="outlined">
      <Typography component="h2" variant="h6">
        {t('admin.packages.title')}
      </Typography>
      {actionError && (
        <Typography color="error" role="alert" variant="body2">
          {t('admin.error.action')}
        </Typography>
      )}
      {packages.length === 0 ? (
        <Typography color="text.secondary" marginTop={1}>
          {t('admin.packages.empty')}
        </Typography>
      ) : (
        <TableContainer sx={{ marginTop: 1, overflowX: 'auto' }}>
          <Table data-testid="admin-packages-table" size="small">
            <TableHead>
              <TableRow>
                <TableCell>{t('admin.packages.column.name')}</TableCell>
                <TableCell>{t('admin.packages.column.version')}</TableCell>
                <TableCell>{t('admin.packages.column.visibility')}</TableCell>
                <TableCell align="right">{t('admin.packages.column.actions')}</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {packages.map((pkg) => (
                <TableRow data-testid={`admin-package-${pkg.name}`} hover={true} key={pkg.name}>
                  <TableCell>{pkg.name}</TableCell>
                  <TableCell>{pkg.version ?? '-'}</TableCell>
                  <TableCell>
                    <Chip
                      data-testid={`admin-visibility-${pkg.name}`}
                      label={
                        pkg.visibility === 'private'
                          ? t('admin.packages.private')
                          : t('admin.packages.public')
                      }
                      size="small"
                    />
                  </TableCell>
                  <TableCell align="right">
                    <Button
                      data-testid={`admin-visibility-toggle-${pkg.name}`}
                      disabled={busyPackage === pkg.name}
                      onClick={() => toggle(pkg.name, pkg.visibility)}
                      size="small"
                    >
                      {pkg.visibility === 'private'
                        ? t('admin.packages.make-public')
                        : t('admin.packages.make-private')}
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      )}
    </Paper>
  );
};

export default AdminPackages;
