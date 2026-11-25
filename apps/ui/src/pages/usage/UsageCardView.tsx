// One Token Analyzer card: a whole presentation, a study session, one slide, questions, or
// preparation. Click it and it opens up in place (no pop-up) to show where the tokens went.
import { Badge, Box, Collapse, Group, SimpleGrid, Table, Text, UnstyledButton } from '@mantine/core';
import { IconChevronDown } from '@tabler/icons-react';
import type { UsageCard, UsageSums } from '../../api/types';
import { colors } from '../../theme';
import { duration, tokens, usd, when } from './format';

const TYPE_LOOK: Record<string, { emoji: string; color: string }> = {
  presentation: { emoji: '🎤', color: 'plum' },
  study: { emoji: '📚', color: 'aqua' },
  slide: { emoji: '🖼️', color: 'grape' },
  questions: { emoji: '🙋', color: 'orange' },
  prep: { emoji: '⚙️', color: 'gray' },
};

const KIND_EMOJI: Record<string, string> = {
  talk: '🗣️',
  drawing: '✏️',
  example: '💡',
  question: '🙋',
  explain: '🖼️',
  prep: '⚙️',
  other: '•',
};

export const STYLE_NAMES: Record<string, string> = {
  class: 'Standard',
  story: 'Story mode',
  professional: 'Professional mode',
  exam: 'Exam mode',
  visual: 'Visual mode',
};

/** One bar per part, all in one colour: the length is the share of this card's cost. */
function PartBar({ label, part, of }: { label: string; part: UsageSums; of: number }) {
  const share = of > 0 ? part.cost / of : 0;
  return (
    <Box title={`${label}: ${usd(part.cost)} · ${tokens(part.tokens)} tokens · ${part.calls} calls`}>
      <Group justify="space-between" gap={8} wrap="nowrap">
        <Text fz={13.5} fw={600} c={colors.ink}>
          {label}
        </Text>
        <Text fz={13} c={colors.muted} style={{ whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>
          {tokens(part.tokens)} tokens · <b style={{ color: colors.ink }}>{usd(part.cost)}</b> · {Math.round(share * 100)}%
        </Text>
      </Group>
      <Box mt={5} h={8} style={{ background: colors.soft, borderRadius: 4, overflow: 'hidden' }}>
        <Box h="100%" w={`${Math.max(share * 100, part.cost > 0 ? 1.5 : 0)}%`} style={{ background: colors.plum, borderRadius: 4 }} />
      </Box>
    </Box>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <Box p={12} style={{ background: colors.soft, borderRadius: 10 }}>
      <Text fz={11.5} fw={700} c={colors.muted} tt="uppercase" style={{ letterSpacing: 0.4 }}>
        {label}
      </Text>
      <Text fz={20} fw={800} c={colors.ink} style={{ fontVariantNumeric: 'tabular-nums' }}>
        {value}
      </Text>
      {hint && (
        <Text fz={11.5} c={colors.muted}>
          {hint}
        </Text>
      )}
    </Box>
  );
}

export function UsageCardView({ card, open, onToggle }: { card: UsageCard; open: boolean; onToggle: () => void }) {
  const look = TYPE_LOOK[card.type] ?? TYPE_LOOK.prep;
  const t = card.totals;
  const slides = card.by_slide.filter((s) => s.slide !== null);
  const perSlide = slides.length ? t.cost / slides.length : null;
  const length = duration(card.started_at, card.ended_at);
  const running = (card.type === 'presentation' || card.type === 'study') && !card.ended_at;

  return (
    <Box
      style={{
        background: colors.surface,
        border: `1px solid ${open ? colors.plum : colors.border}`,
        borderRadius: 14,
        boxShadow: open ? '0 10px 30px rgba(42,36,64,0.12)' : 'none',
        transition: 'box-shadow 200ms, border-color 200ms',
      }}
    >
      <UnstyledButton onClick={onToggle} aria-expanded={open} w="100%" p={16}>
        <Group gap={14} wrap="nowrap" align="center">
          <Text fz={26} aria-hidden>
            {look.emoji}
          </Text>
          <Box style={{ flex: 1, minWidth: 0 }}>
            <Group gap={8} wrap="wrap">
              <Text fw={800} fz={15.5} c={colors.ink} truncate maw={420}>
                {card.title}
              </Text>
              <Badge size="sm" variant="light" color={look.color}>
                {card.type_name}
              </Badge>
              {card.style && card.type !== 'prep' && (
                <Badge size="sm" variant="outline" color="gray">
                  {STYLE_NAMES[card.style] ?? card.style}
                </Badge>
              )}
              {running && (
                <Badge size="sm" color="red" variant="dot">
                  Live
                </Badge>
              )}
            </Group>
            <Text fz={12.5} c={colors.muted} mt={3}>
              {when(card.started_at)}
              {length ? ` · ${length}` : ''}
              {card.deck_name && card.type !== 'presentation' && card.type !== 'study' ? ` · ${card.deck_name}` : ''}
              {` · ${t.calls} Claude ${t.calls === 1 ? 'call' : 'calls'}`}
            </Text>
          </Box>
          <Box ta="right">
            <Text fz={20} fw={800} c={colors.ink} style={{ fontVariantNumeric: 'tabular-nums' }}>
              {usd(t.cost)}
            </Text>
            <Text fz={12} c={colors.muted}>
              {tokens(t.tokens)} tokens
            </Text>
          </Box>
          <IconChevronDown
            size={20}
            color={colors.muted}
            style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 200ms' }}
          />
        </Group>
      </UnstyledButton>

      <Collapse expanded={open}>
        <Box px={16} pb={18} pt={2} style={{ borderTop: `1px solid ${colors.border}` }}>
          <SimpleGrid cols={{ base: 2, sm: 4 }} spacing={10} mt={14}>
            <Stat label="Total cost" value={usd(t.cost)} hint={card.models.join(', ') || undefined} />
            <Stat label="Tokens" value={tokens(t.tokens)} hint={`${tokens(t.input)} in · ${tokens(t.output)} out`} />
            <Stat
              label="From cache"
              value={tokens(t.cache_read)}
              hint="tokens re-read from cache (10× cheaper)"
            />
            {perSlide !== null ? (
              <Stat label="Per slide" value={usd(perSlide)} hint={`${slides.length} slides`} />
            ) : (
              <Stat label="Web searches" value={String(t.searches)} hint={`${usd(t.searches * 0.01)} of the cost`} />
            )}
          </SimpleGrid>

          <Text fw={800} fz={14} c={colors.ink} mt={18} mb={10}>
            Where the tokens went
          </Text>
          {card.by_kind.length === 0 ? (
            <Text fz={13} c={colors.muted}>
              No Claude calls: everything was ready from preparation, so this cost nothing extra.
            </Text>
          ) : (
            <Box style={{ display: 'grid', gap: 12 }}>
              {card.by_kind.map((k) => (
                <PartBar key={k.kind} label={`${KIND_EMOJI[k.kind] ?? '•'} ${k.name}`} part={k} of={t.cost} />
              ))}
            </Box>
          )}

          {slides.length > 0 && (
            <>
              <Text fw={800} fz={14} c={colors.ink} mt={20} mb={6}>
                {card.type === 'slide' ? 'Slide' : 'Slide by slide'}
              </Text>
              <Table striped highlightOnHover fz={13} verticalSpacing={6}>
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>Slide</Table.Th>
                    <Table.Th ta="right">Calls</Table.Th>
                    <Table.Th ta="right">Input</Table.Th>
                    <Table.Th ta="right">Output</Table.Th>
                    <Table.Th ta="right">Searches</Table.Th>
                    <Table.Th ta="right">Cost</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody style={{ fontVariantNumeric: 'tabular-nums' }}>
                  {slides.map((s) => (
                    <Table.Tr key={s.slide}>
                      <Table.Td fw={600}>{s.slide}</Table.Td>
                      <Table.Td ta="right">{s.calls}</Table.Td>
                      <Table.Td ta="right">{tokens(s.input + s.cache_read + s.cache_write)}</Table.Td>
                      <Table.Td ta="right">{tokens(s.output)}</Table.Td>
                      <Table.Td ta="right">{s.searches}</Table.Td>
                      <Table.Td ta="right" fw={700}>
                        {usd(s.cost)}
                      </Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            </>
          )}
        </Box>
      </Collapse>
    </Box>
  );
}
