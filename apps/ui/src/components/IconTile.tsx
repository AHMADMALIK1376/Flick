// A line icon in a small tinted square: the picture on mode cards and analyzer cards
// (instead of emoji).
import { Box } from '@mantine/core';
import type { Icon } from '@tabler/icons-react';
import { colors } from '../theme';

export function IconTile({ icon: TheIcon, size = 40, tint = colors.soft, color = colors.plum }: { icon: Icon; size?: number; tint?: string; color?: string }) {
  return (
    <Box
      aria-hidden
      style={{
        width: size,
        height: size,
        borderRadius: Math.round(size / 4),
        background: tint,
        display: 'grid',
        placeItems: 'center',
        flexShrink: 0,
      }}
    >
      <TheIcon size={Math.round(size * 0.55)} stroke={1.7} color={color} />
    </Box>
  );
}
