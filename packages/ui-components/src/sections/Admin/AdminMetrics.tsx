import { Box, Chip, Paper, Typography } from '@mui/material';
import React from 'react';
import { useTranslation } from 'react-i18next';

import { useAdminMetrics } from './useAdmin';

function formatUptime(seconds: number): string {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (days > 0) {
    return `${days}d ${hours}h`;
  }
  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  return `${minutes}m`;
}

function formatBytes(bytes: number): string {
  return `${Math.round(bytes / 1024 / 1024)} MB`;
}

const AdminMetrics: React.FC = () => {
  const { t } = useTranslation();
  const { data, error } = useAdminMetrics(true);

  if (error || !data) {
    return null;
  }

  const stats: Array<{ label: string; value: string }> = [
    { label: t('admin.metrics.version'), value: data.version },
    { label: t('admin.metrics.node'), value: data.node },
    { label: t('admin.metrics.uptime'), value: formatUptime(data.uptime) },
    { label: t('admin.metrics.packages'), value: String(data.counts.packages) },
    {
      label: t('admin.metrics.users'),
      value: data.counts.users === null ? 'n/a' : String(data.counts.users),
    },
    { label: t('admin.metrics.requests'), value: String(data.requests.total) },
    { label: t('admin.metrics.memory'), value: formatBytes(data.memory.rss) },
  ];

  return (
    <Paper sx={{ marginTop: 2, padding: 2 }} variant="outlined">
      <Typography component="h2" gutterBottom={true} variant="h6">
        {t('admin.metrics.title')}
      </Typography>
      <Box
        sx={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: 1,
        }}
      >
        {stats.map((stat) => (
          <Chip
            data-testid={`admin-metric-${stat.label}`}
            key={stat.label}
            label={`${stat.label}: ${stat.value}`}
            variant="outlined"
          />
        ))}
      </Box>
      {Object.keys(data.requests.byStatus).length > 0 && (
        <Box
          sx={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: 1,
            marginTop: 1,
          }}
        >
          {Object.entries(data.requests.byStatus).map(([status, count]) => (
            <Chip
              key={status}
              label={`${status}: ${count}`}
              size="small"
              sx={{ opacity: 0.8 }}
              variant="outlined"
            />
          ))}
        </Box>
      )}
    </Paper>
  );
};

export default AdminMetrics;
