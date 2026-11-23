// Badge that says where an answer came from. Used on the answer card, log and presenter view.
import { Badge } from '@mantine/core';
import type { AnswerOrigin } from '../api/types';
import { colors } from '../theme';

const LOOK: Record<AnswerOrigin, { label: string; bg: string; fg: string }> = {
  prepared: { label: 'Prepared', bg: '#e3dfee', fg: colors.plum },
  slides: { label: 'From slides', bg: '#ecf9f8', fg: colors.explainText },
  web: { label: 'Web', bg: '#fdf1e3', fg: '#8a4b0f' },
  general: { label: 'General', bg: colors.soft, fg: colors.muted },
  explain: { label: 'Explain', bg: colors.explainBg, fg: colors.explainText },
  greeting: { label: 'Hello', bg: colors.soft, fg: colors.muted },
  error: { label: 'Problem', bg: '#fbe9e7', fg: '#a3402f' },
};

export function OriginBadge({ origin }: { origin: AnswerOrigin }) {
  const look = LOOK[origin];
  return (
    <Badge radius="sm" variant="filled" styles={{ root: { background: look.bg, color: look.fg } }}>
      {look.label}
    </Badge>
  );
}
