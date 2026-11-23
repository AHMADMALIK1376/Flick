// Flick look: "D4 · Lavender + Soft Aqua buttons". Use these, don't invent new colours.
import { createTheme, type MantineColorsTuple } from '@mantine/core';

export const colors = {
  background: '#f1eff6', // page
  sidebar: '#e6e2f0',
  surface: '#ffffff', // cards
  soft: '#f6f4fa', // soft panels, table stripes
  border: '#dedaea',
  ink: '#2a2440', // main text
  muted: '#5d5675', // secondary text
  plum: '#4b3f72', // brand, active nav, headings accent
  aqua: '#6fcbc4', // highlights, progress
  aquaButton: '#a8e0dc', // primary buttons
  explainBg: '#d6f1ee', // "Explain" badge
  explainText: '#1d5c57',
};

// 10 shades each (lightest → darkest). Index 6 is the main one.
const plum: MantineColorsTuple = [
  '#f3f1f8', '#e3dfee', '#c6bddc', '#a698c9', '#8a79b8',
  '#7766ac', '#5f5190', '#4b3f72', '#3d335d', '#2a2440',
];
const aqua: MantineColorsTuple = [
  '#ecf9f8', '#d6f1ee', '#bde9e6', '#a8e0dc', '#8fd6d0',
  '#7ccfc9', '#6fcbc4', '#4fb1aa', '#3a8f89', '#1d5c57',
];

export const theme = createTheme({
  fontFamily: '"Plus Jakarta Sans", system-ui, sans-serif',
  headings: { fontFamily: '"Plus Jakarta Sans", system-ui, sans-serif', fontWeight: '700' },
  primaryColor: 'plum',
  primaryShade: 7,
  colors: { plum, aqua },
  defaultRadius: 'md',
  black: colors.ink,
  components: {
    // Main buttons are soft aqua with dark text.
    Button: {
      defaultProps: { color: 'aqua.3', c: colors.ink, autoContrast: true },
    },
    Card: {
      defaultProps: { withBorder: true, radius: 'lg', padding: 'lg' },
    },
  },
});
