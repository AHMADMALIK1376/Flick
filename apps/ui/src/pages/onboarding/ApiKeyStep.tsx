// Issue #3 · Design screen: O3 (Claude API key)
//
// Replaces the design's "speech model download" screen: the backend now downloads models by itself.
import { Anchor, Box, Center, PasswordInput, Stack, Text } from '@mantine/core';
import { IconKey } from '@tabler/icons-react';
import { useState } from 'react';
import { api } from '../../api/flick';
import { colors } from '../../theme';
import { StepButton, type StepProps } from './OnboardingFlow';

export function ApiKeyStep({ onNext }: StepProps) {
  const [key, setKey] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function save() {
    const value = key.trim();
    if (!value.startsWith('sk-ant-')) {
      setError("This doesn't look like a Claude key (it should start with sk-ant-).");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await api.updateSettings({ anthropic_api_key: value });
      onNext();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save the key. Try again.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Stack gap={0} align="center">
      <Center w={104} h={104} style={{ borderRadius: '50%', background: colors.surface, border: `1px solid ${colors.border}` }}>
        <IconKey size={42} color={colors.plum} />
      </Center>
      <Text fz={24} fw={800} c={colors.ink} mt={30}>
        Add your Claude API key
      </Text>
      <Text fz={14.5} c={colors.muted} ta="center" maw={440} mt={8}>
        Flick uses Claude to prepare and answer questions. Your key stays on this computer.
      </Text>
      <Box w="100%" mt={26}>
        <PasswordInput
          size="md"
          label="Claude API key"
          placeholder="sk-ant-…"
          value={key}
          onChange={(e) => {
            setKey(e.currentTarget.value);
            setError(null);
          }}
          onKeyDown={(e) => e.key === 'Enter' && key.trim() && void save()}
          error={error}
          autoComplete="off"
        />
        <Text fz={12.5} c={colors.muted} mt={8}>
          Get one at{' '}
          <Anchor href="https://console.anthropic.com" target="_blank" rel="noreferrer" fz={12.5} c={colors.plum} fw={600}>
            console.anthropic.com
          </Anchor>
          .
        </Text>
        <StepButton onClick={save} loading={saving} disabled={!key.trim()}>
          Save key
        </StepButton>
      </Box>
    </Stack>
  );
}
