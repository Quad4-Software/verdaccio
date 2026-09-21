import { grey } from '@mui/material/colors';

export const PRIMARY_COLOR = '#0A0A0B';

export const baseColors = {
  primary: {
    main: PRIMARY_COLOR,
  },
  secondary: {
    main: '#52525B',
  },
} as const;

export const greyDark = grey[900];
export const greyMedium = grey[700];
export const greyLight = grey[200];
