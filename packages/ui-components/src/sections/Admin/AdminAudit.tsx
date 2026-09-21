import {
  Paper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material';
import React from 'react';
import { useTranslation } from 'react-i18next';

import { useAdminAudit } from './useAdmin';

const AdminAudit: React.FC = () => {
  const { t } = useTranslation();
  const { data, error } = useAdminAudit(true);

  if (error) {
    return null;
  }

  const entries = data?.audit ?? [];

  return (
    <Paper sx={{ marginTop: 2, padding: 2 }} variant="outlined">
      <Typography component="h2" variant="h6">
        {t('admin.audit.title')}
      </Typography>
      {entries.length === 0 ? (
        <Typography color="text.secondary" marginTop={1}>
          {t('admin.audit.empty')}
        </Typography>
      ) : (
        <TableContainer sx={{ marginTop: 1, overflowX: 'auto' }}>
          <Table data-testid="admin-audit-table" size="small">
            <TableHead>
              <TableRow>
                <TableCell>{t('admin.audit.column.time')}</TableCell>
                <TableCell>{t('admin.audit.column.actor')}</TableCell>
                <TableCell>{t('admin.audit.column.action')}</TableCell>
                <TableCell>{t('admin.audit.column.target')}</TableCell>
                <TableCell>{t('admin.audit.column.detail')}</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {entries.map((entry, index) => (
                <TableRow data-testid={`admin-audit-${index}`} key={`${entry.time}-${index}`}>
                  <TableCell>{new Date(entry.time).toLocaleString()}</TableCell>
                  <TableCell>{entry.actor}</TableCell>
                  <TableCell>{entry.action}</TableCell>
                  <TableCell>{entry.target ?? '-'}</TableCell>
                  <TableCell>{entry.detail ?? '-'}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      )}
    </Paper>
  );
};

export default AdminAudit;
