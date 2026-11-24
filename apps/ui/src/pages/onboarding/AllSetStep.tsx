// Issue #3 · Design screen: O4 Ready
//
// "How do you want to ask?" Toggle / Hold to talk, then start using Flick.
import { Box, Group, Radio, Stack, Text } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconCheck } from '@tabler/icons-react';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../../api/flick';
import type { Settings } from '../../api/types';
import { colors } from '../../theme';
import { StepButton } from './OnboardingFlow';

type Mode = Settings['hotkey_mode'];

export function AllSetStep() {
  const navigate = useNavigate();
  const [mode, setMode] = useState<Mode>('toggle');
  const [hotkey, setHotkey] = useState('Ctrl+Shift+Space');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api
      .getSettings()
      .then((s) => {
        setMode(s.hotkey_mode);
        setHotkey(s.ask_hotkey);
      })
      .catch(() => undefined);
  }, []);

  async function finish() {
    setSaving(true);
    try {
      await api.updateSettings({ hotkey_mode: mode });
      navigate('/presentation');
    } catch (err) {
      notifications.show({ color: 'red', message: err instanceof Error ? err.message : 'Something went wrong.' });
    } finally {
      setSaving(false);
    }
  }

  const choices: { value: Mode; title: string; text: string }[] = [
    { value: 'toggle', title: 'Toggle', text: `Press ${hotkey} to start, press again to stop.` },
    { value: 'push-to-talk', title: 'Hold to talk', text: `Hold ${hotkey} while you speak; let go to stop.` },
  ];

  return (
    <Stack gap={0}>
      <Text fz={24} fw={800} c={colors.ink} ta="center">
        How do you want to ask?
      </Text>
      <Text fz={14.5} c={colors.muted} ta="center" mt={8}>
        You can change this later in Settings.
      </Text>

      <Radio.Group value={mode} onChange={(v) => setMode(v as Mode)} mt={26}>
        <Stack gap={12}>
          {choices.map((c) => {
            const checked = mode === c.value;
            return (
              <Radio.Card
                key={c.value}
                value={c.value}
                radius={14}
                p={18}
                style={{
                  border: `2px solid ${checked ? colors.aqua : colors.border}`,
                  background: checked ? '#eef9f8' : colors.surface,
                }}
              >
                <Text fz={15} fw={700} c={colors.ink}>
                  {c.title}
                </Text>
                <Text fz={13.5} c={colors.muted} mt={2}>
                  {c.text}
                </Text>
              </Radio.Card>
            );
          })}
        </Stack>
      </Radio.Group>

      <Box mt={20} p="12px 16px" style={{ background: '#dcefe2', borderRadius: 12 }}>
        <Group gap={8} wrap="nowrap">
          <IconCheck size={18} color="#24583a" />
          <Text fz={13.5} fw={700} c="#24583a">
            All set. Next, load your slides on the Presentation page.
          </Text>
        </Group>
      </Box>

      <StepButton onClick={finish} loading={saving}>
        Start using Flick
      </StepButton>
    </Stack>
  );
}
