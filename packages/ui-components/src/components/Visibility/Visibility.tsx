import Button from '@mui/material/Button';
import List from '@mui/material/List';
import ListItem from '@mui/material/ListItem';
import React from 'react';
import { useTranslation } from 'react-i18next';
import { useSWRConfig } from 'swr';

import { buildUrl } from '../../api/use-data';
import { useDataMutation } from '../../api/use-data-mutation';
import { getConfiguration } from '../../configuration';
import { useAuth, useVersion } from '../../providers';
import { stripTrailingSlash } from '../../store/utils';
import { APIRoute } from '../../utils/routes';
import { DistChips, StyledText } from '../Distribution/styles';

const Visibility: React.FC = () => {
  const { t } = useTranslation();
  const { userState } = useAuth();
  const { packageMeta, packageName, packageVersion } = useVersion();
  const { mutate } = useSWRConfig();
  const basePath = stripTrailingSlash(getConfiguration().base);
  const { trigger, isMutating, error } = useDataMutation<{ success: boolean }>(
    basePath,
    APIRoute.VISIBILITY,
    'PUT',
    { buildUrl: (base, route) => buildUrl(base, route as APIRoute, packageName) }
  );

  if (!packageName || !userState?.username) {
    return null;
  }

  const isPrivate = packageMeta?.visibility === 'private';

  const handleToggle = async () => {
    await trigger({ visibility: isPrivate ? 'public' : 'private' });
    mutate(buildUrl(basePath, APIRoute.SIDEBAR, packageName, packageVersion));
  };

  return (
    <List subheader={<StyledText variant="subtitle1">{t('sidebar.visibility.title')}</StyledText>}>
      <ListItem sx={{ paddingLeft: 0, paddingRight: 0, flexWrap: 'wrap' }}>
        <DistChips
          data-testid="visibility-chip"
          label={isPrivate ? t('sidebar.visibility.private') : t('sidebar.visibility.public')}
        />
        <Button
          data-testid="visibility-toggle"
          disabled={isMutating}
          onClick={handleToggle}
          size="small"
        >
          {isPrivate ? t('sidebar.visibility.make-public') : t('sidebar.visibility.make-private')}
        </Button>
      </ListItem>
      {error ? (
        <ListItem sx={{ paddingLeft: 0, paddingRight: 0 }}>
          <StyledText color="error" data-testid="visibility-error" variant="body2">
            {t('sidebar.visibility.error')}
          </StyledText>
        </ListItem>
      ) : null}
    </List>
  );
};

export default Visibility;
