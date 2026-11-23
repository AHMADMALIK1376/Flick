// Flick wordmark: the spotlight is the dot on the "i".
// TODO(#2): replace this simple version with the final logo from the design canvas
// (Spotlight mark #1 + wordmark #11), exported as SVG into src/assets/.
import { Text } from '@mantine/core';
import { colors } from '../theme';

export function Logo({ size = 26 }: { size?: number }) {
  return (
    <Text fw={800} fz={size} c={colors.plum} style={{ letterSpacing: -0.5, lineHeight: 1 }}>
      Fl
      <span style={{ position: 'relative' }}>
        ı
        <span
          style={{
            position: 'absolute',
            left: '50%',
            top: '-0.12em',
            width: '0.26em',
            height: '0.26em',
            transform: 'translateX(-50%)',
            borderRadius: '50%',
            background: colors.aqua,
            boxShadow: `0 0 0.3em ${colors.aqua}`,
          }}
        />
      </span>
      ck
    </Text>
  );
}
