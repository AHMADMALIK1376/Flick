// Flick logo.
//   <Logo />      the wordmark: "Flick" with the aqua spotlight as the dot on the "i"
//   <LogoMark />  the Spotlight mark on its own (answer card, mic, icons)
import { Box } from '@mantine/core';
import dotUrl from '../assets/flick-dot.svg';
import markUrl from '../assets/flick-mark.svg';
import { colors } from '../theme';

export function Logo({ size = 26 }: { size?: number }) {
  return (
    <Box
      component="span"
      role="img"
      aria-label="Flick"
      style={{
        display: 'inline-block',
        fontSize: size,
        fontWeight: 800,
        color: colors.ink,
        letterSpacing: -size / 38,
        lineHeight: 1,
        whiteSpace: 'nowrap',
      }}
    >
      <span aria-hidden>Fl</span>
      <span aria-hidden style={{ position: 'relative', display: 'inline-block' }}>
        ı
        <img
          src={dotUrl}
          alt=""
          style={{
            position: 'absolute',
            left: '50%',
            top: '-0.06em',
            width: '0.5em',
            height: '0.5em',
            transform: 'translateX(-50%)',
          }}
        />
      </span>
      <span aria-hidden>ck</span>
    </Box>
  );
}

export function LogoMark({ size = 24 }: { size?: number }) {
  return <img src={markUrl} alt="Flick" width={size} height={size} style={{ display: 'block' }} />;
}
