// Badge that says where an answer came from. Used on the answer card, log and presenter view.
import { Badge } from '@mantine/core';
import type { AnswerOrigin } from '../api/types';
import { colors } from '../theme';

// Colours and labels from the design (D4 palette).
const LOOK: Record<AnswerOrigin, { label: string; bg: string; fg: string }> = {
  prepared: { label: 'Prepared answer', bg: '#dcefe2', fg: '#24583a' },
  slides: { label: 'From your slides', bg: '#e4e0f3', fg: colors.plum },
  web: { label: 'From the web', bg: '#fbe3d6', fg: '#8a4220' },
  general: { label: 'General knowledge', bg: '#ece9f2', fg: '#4a4560' },
  explain: { label: 'Explaining to the audience', bg: colors.explainBg, fg: colors.explainText },
  greeting: { label: 'Hello', bg: '#ece9f2', fg: '#4a4560' },
  error: { label: 'Problem', bg: '#fbe0e0', fg: '#9b2c2c' },
  example: { label: 'Drawn example', bg: '#fdf1dc', fg: '#7a5212' },
};

export function OriginBadge({ origin }: { origin: AnswerOrigin }) {
  const look = LOOK[origin];
  return (
    <Badge radius="xl" variant="filled" tt="none" fw={600} styles={{ root: { background: look.bg, color: look.fg } }}>
      {look.label}
    </Badge>
  );
}
