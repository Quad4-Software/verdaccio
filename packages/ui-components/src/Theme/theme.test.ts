import { PRIMARY_COLOR } from './colors';
import { getModePalette } from './modes';
import { getTheme } from './theme';
import { breakPoints, fontSize, fontWeight } from './tokens';

describe('getModePalette', () => {
  test('should return light palette by default', () => {
    const palette = getModePalette('light');
    expect(palette.mode).toBe('light');
    expect(palette.primary).toEqual({ main: PRIMARY_COLOR });
    expect(palette.background).toEqual({ default: '#FAFAFA', paper: '#ffffff' });
  });

  test('should return dark palette with paper primary', () => {
    const palette = getModePalette('dark');
    expect(palette.mode).toBe('dark');
    expect(palette.primary).toEqual({ main: '#FAFAFA' });
    expect(palette.secondary).toEqual({ main: '#A1A1AA' });
    expect(palette.background).toEqual({ default: '#0A0A0B', paper: '#16161A' });
  });

  test('should use custom primary color when provided', () => {
    const customColor = '#ff5733';
    const palette = getModePalette('light', customColor);
    expect(palette.primary).toEqual({ main: customColor });
  });

  test('should replace near-white primary in light mode', () => {
    const palette = getModePalette('light', '#FAFAFA');
    expect(palette.primary).toEqual({ main: PRIMARY_COLOR });
  });

  test('should ignore custom primary color in dark mode', () => {
    const customColor = '#ff5733';
    const palette = getModePalette('dark', customColor);
    expect(palette.primary).toEqual({ main: '#FAFAFA' });
  });
});

describe('getTheme', () => {
  test('should create a light theme', () => {
    const theme = getTheme('light');
    expect(theme.palette.mode).toBe('light');
    expect(theme.palette.primary.main).toBe(PRIMARY_COLOR);
    expect(theme.palette.background.default).toBe('#FAFAFA');
    expect(theme.palette.background.paper).toBe('#ffffff');
  });

  test('should create a dark theme with paper primary', () => {
    const theme = getTheme('dark');
    expect(theme.palette.mode).toBe('dark');
    expect(theme.palette.primary.main).toBe('#FAFAFA');
    expect(theme.palette.background.default).toBe('#0A0A0B');
    expect(theme.palette.background.paper).toBe('#16161A');
  });

  test('should apply custom primary color', () => {
    const theme = getTheme('light', '#e53935');
    expect(theme.palette.primary.main).toBe('#e53935');
  });

  test('should include custom tokens', () => {
    const theme = getTheme('light');
    expect(theme.fontSize).toEqual(fontSize);
    expect(theme.fontWeight).toEqual(fontWeight);
    expect(theme.breakPoints).toEqual(breakPoints);
  });

  test('should set typography font family', () => {
    const theme = getTheme('light');
    expect(theme.typography.fontFamily).toContain('ui-sans-serif');
    expect(theme.typography.fontFamily).toContain('system-ui');
  });

  test('should override MuiPaper background image', () => {
    const theme = getTheme('light');
    expect(theme.components?.MuiPaper?.styleOverrides).toEqual({
      root: { backgroundImage: 'unset' },
    });
  });
});
