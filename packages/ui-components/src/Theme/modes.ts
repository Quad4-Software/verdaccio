import { common } from '@mui/material/colors';
import type { PaletteOptions } from '@mui/material/styles';

import { PRIMARY_COLOR, baseColors } from './colors';

export type ThemeMode = 'light' | 'dark';

export const customPaletteColors = {
  black: '#000',
  cyanBlue: '#16161A',
  greyLight: '#d3d3d3',
  greyLight2: '#908ba1',
  greyDark2: '#586069',
  greyGainsboro: '#e3e3e3',
  greyAthens: '#d3dddd',
  snow: '#f9f9f9',
  love: '#e25555',
  nobel01: '#999999',
} as const;

const DARK_PRIMARY = '#FAFAFA';
const LIGHT_PRIMARY = PRIMARY_COLOR;

function isNearWhite(color: string): boolean {
  const hex = color.trim().toLowerCase();
  return (
    hex === '#fff' ||
    hex === '#ffffff' ||
    hex === '#fafafa' ||
    hex === 'white' ||
    hex === common.white.toLowerCase()
  );
}

export const getModePalette = (mode: ThemeMode, primaryColor?: string): PaletteOptions => {
  if (mode === 'dark') {
    return {
      mode,
      primary: { main: DARK_PRIMARY },
      secondary: { main: '#A1A1AA' },
      background: {
        default: '#0A0A0B',
        paper: '#16161A',
      },
      ...customPaletteColors,
    };
  }

  const configured = primaryColor || baseColors.primary.main;
  const primaryMain = isNearWhite(configured) ? LIGHT_PRIMARY : configured;

  return {
    mode,
    primary: { main: primaryMain },
    secondary: { main: '#52525B' },
    background: {
      default: '#FAFAFA',
      paper: '#ffffff',
    },
    ...customPaletteColors,
  };
};
