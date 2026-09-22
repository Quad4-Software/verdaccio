import styled from '@emotion/styled';
import * as FlagsIcon from 'country-flag-icons/react/3x2';
import React from 'react';
import { Trans, useTranslation } from 'react-i18next';

import type { Theme } from '../../';
import { Logo, useConfig } from '../../';
import { Earth } from '../../components/Icons';
import { Inner, Left, Love, Right, Wrapper } from './styles';

const Footer = () => {
  const { t } = useTranslation();
  const { configOptions } = useConfig();
  return (
    <Wrapper data-testid="footer">
      <Inner>
        <Left>
          <Trans components={[<Love key="love" />]} i18nKey="footer.made-with-love-on" />
          <ToolTip>
            <StyledEarth />
            <Flags data-flags="true">
              <Icon>
                <FlagsIcon.ES title={t('flag.spain')} />
              </Icon>
              <Icon>
                <FlagsIcon.NI title={t('flag.nicaragua')} />
              </Icon>
              <Icon>
                <FlagsIcon.IN title={t('flag.india')} />
              </Icon>
              <Icon>
                <FlagsIcon.BR title={t('flag.brazil')} />
              </Icon>
              <Icon>
                <FlagsIcon.CN title={t('flag.china')} />
              </Icon>
              <Icon>
                <FlagsIcon.AU title={t('flag.australia')} />
              </Icon>
              <Icon>
                <FlagsIcon.DE title={t('flag.germany')} />
              </Icon>
              <Icon>
                <FlagsIcon.TW title={t('flag.taiwan')} />
              </Icon>
              <Icon>
                <FlagsIcon.AT title={t('flag.austria')} />
              </Icon>
              <Icon>
                <FlagsIcon.CA title={t('flag.canada')} />
              </Icon>
            </Flags>
          </ToolTip>
        </Left>
        <Right>
          {configOptions?.version ? (
            <>
              <Logo size="x-small" title={configOptions.version} />
              <Version data-testid="version-footer">{configOptions.version}</Version>
            </>
          ) : null}
        </Right>
      </Inner>
    </Wrapper>
  );
};

export default Footer;

const Version = styled('span')<{ theme?: Theme }>(({ theme }) => ({
  color: theme.palette.mode === 'dark' ? theme.palette.secondary.main : theme.palette.nobel01,
  fontSize: theme.fontSize.sm,
}));

const StyledEarth = styled(Earth)<{ theme?: Theme }>(({ theme }) => ({
  margin: theme.spacing(0, 1),
}));

const Flags = styled('span')<{ theme?: Theme }>(({ theme }) => ({
  display: 'inline-grid',
  gridTemplateColumns: 'repeat(10, max-content)',
  gridGap: theme.spacing(0, 1),
  position: 'absolute',
  background: theme.palette.greyAthens,
  padding: '1px 4px',
  borderRadius: 3,
  height: 20,
  alignItems: 'center',
  visibility: 'hidden',
  top: -2,
  ':before': {
    content: "''",
    position: 'absolute',
    top: '29%',
    left: -4,
    marginLeft: -5,
    border: '5px solid',
    borderColor: `${theme.palette.greyAthens} transparent transparent transparent`,
    transform: 'rotate(90deg)',
  },
}));

const Icon = styled('div')({
  width: '10px',
});

const ToolTip = styled('span')({
  position: 'relative',
  height: '18px',
  ':hover': {
    '& [data-flags="true"]': {
      visibility: 'visible',
    },
  },
});
