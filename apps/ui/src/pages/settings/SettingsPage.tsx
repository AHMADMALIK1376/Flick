// Issue #7 · Design screen: D6 Settings
//
// Form for all settings. Sends only changed fields. Never shows the full API key.
// Backend: GET/PATCH /settings, GET /models, POST /settings/test-key
import {
  Box,
  Button,
  Card,
  Center,
  Checkbox,
  Group,
  Loader,
  PasswordInput,
  Radio,
  Select,
  SimpleGrid,
  Stack,
  Text,
  TextInput,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconCheck, IconPlugConnected } from '@tabler/icons-react';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { api } from '../../api/flick';
import type { ModelOption, Settings, SettingsUpdate } from '../../api/types';
import { PageHeader } from '../../components/PageHeader';
import { colors } from '../../theme';
import { ChoiceCard } from './ChoiceCard';
import { HotkeyInput } from './HotkeyInput';

type Form = Omit<Settings, 'anthropic_api_key' | 'has_api_key'>;

const KEY_REASONS: Record<string, string> = {
  invalid_key: 'The key was rejected.',
  network: 'No internet connection.',
  timeout: 'Claude took too long. Try again.',
  missing_key: 'Add a key first.',
  rate_limit: 'Too many requests right now. Try again in a minute.',
};

function toForm(s: Settings): Form {
  const { anthropic_api_key: _key, has_api_key: _has, ...rest } = s;
  return rest;
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : 'Something went wrong.';
}

export function SettingsPage() {
  const [saved, setSaved] = useState<Settings | null>(null);
  const [models, setModels] = useState<ModelOption[]>([]);
  const [form, setForm] = useState<Form | null>(null);
  const [newKey, setNewKey] = useState<string | null>(null); // null = keep the saved key
  const [saving, setSaving] = useState(false);
  const [keyCheck, setKeyCheck] = useState<{ busy: boolean; ok?: boolean; text?: string }>({ busy: false });

  useEffect(() => {
    Promise.all([api.getSettings(), api.models()])
      .then(([s, m]) => {
        setSaved(s);
        setForm(toForm(s));
        setModels(m);
        if (!s.has_api_key) setNewKey('');
      })
      .catch((err) => notifications.show({ color: 'red', message: errorText(err) }));
  }, []);

  const changes = useMemo<SettingsUpdate>(() => {
    if (!saved || !form) return {};
    const base = toForm(saved);
    const diff: SettingsUpdate = {};
    (Object.keys(form) as (keyof Form)[]).forEach((k) => {
      if (form[k] !== base[k]) (diff as Record<string, unknown>)[k] = form[k];
    });
    if (newKey && newKey.trim()) diff.anthropic_api_key = newKey.trim();
    return diff;
  }, [saved, form, newKey]);

  if (!form || !saved) {
    return (
      <Center h={300}>
        <Loader color="plum" />
      </Center>
    );
  }

  const set = <K extends keyof Form>(key: K, value: Form[K]) => setForm({ ...form, [key]: value });
  const sameHotkeys = form.ask_hotkey === form.explain_hotkey;
  const keyLooksWrong = !!newKey?.trim() && !newKey.trim().startsWith('sk-ant-');
  const canSave = Object.keys(changes).length > 0 && !sameHotkeys && !keyLooksWrong && !saving;

  async function save() {
    setSaving(true);
    try {
      const updated = await api.updateSettings(changes);
      setSaved(updated);
      setForm(toForm(updated));
      setNewKey(updated.has_api_key ? null : '');
      setKeyCheck({ busy: false });
      notifications.show({ color: 'teal', message: 'Settings saved' });
    } catch (err) {
      notifications.show({ color: 'red', message: errorText(err) });
    } finally {
      setSaving(false);
    }
  }

  async function testKey() {
    setKeyCheck({ busy: true });
    try {
      const r = await api.testKey();
      setKeyCheck({ busy: false, ok: r.ok, text: r.ok ? 'Key works' : KEY_REASONS[r.reason ?? ''] ?? "Couldn't check the key right now." });
    } catch (err) {
      setKeyCheck({ busy: false, ok: false, text: errorText(err) });
    }
  }

  return (
    <Stack gap={24} maw={860}>
      <PageHeader title="Settings" subtitle="Choose how Flick answers, which AI it uses, and how you ask." />

      <Section label="Answers">
        <Radio.Group value={form.answer_mode} onChange={(v) => set('answer_mode', v as Form['answer_mode'])}>
          <Group gap={14} align="stretch">
            <ChoiceCard value="speak" checked={form.answer_mode === 'speak'} title="Speak to the room" text="Flick reads each answer aloud." />
            <ChoiceCard
              value="private"
              checked={form.answer_mode === 'private'}
              title="Show only to me"
              text="Answers appear on your screen. Press Speak if you want Flick to say it."
            />
          </Group>
        </Radio.Group>
      </Section>

      <Section label="AI">
        <SimpleGrid cols={{ base: 1, md: 2 }} spacing={18}>
          <Select
            size="md"
            label="Model"
            data={models.map((m) => ({ value: m.id, label: m.name }))}
            value={form.model}
            onChange={(v) => v && set('model', v)}
            allowDeselect={false}
          />
          <Stack gap={6}>
            {newKey === null ? (
              <Group gap={8} align="flex-end" wrap="nowrap">
                <TextInput size="md" label="Claude API key" value={saved.anthropic_api_key} readOnly style={{ flex: 1 }} />
                <Button size="md" variant="default" onClick={() => setNewKey('')}>
                  Change
                </Button>
              </Group>
            ) : (
              <Group gap={8} align="flex-start" wrap="nowrap">
                <PasswordInput
                  size="md"
                  label="Claude API key"
                  placeholder="sk-ant-…"
                  value={newKey}
                  onChange={(e) => setNewKey(e.currentTarget.value)}
                  error={keyLooksWrong ? "This doesn't look like a Claude key (it starts with sk-ant-)." : undefined}
                  style={{ flex: 1 }}
                  autoComplete="off"
                />
                {saved.has_api_key && (
                  <Button size="md" variant="default" mt={25} onClick={() => setNewKey(null)}>
                    Cancel
                  </Button>
                )}
              </Group>
            )}
            <Group gap={10}>
              <Button
                size="xs"
                variant="default"
                leftSection={<IconPlugConnected size={14} />}
                loading={keyCheck.busy}
                disabled={!saved.has_api_key || !!newKey}
                onClick={testKey}
              >
                Test key
              </Button>
              {keyCheck.text && (
                <Text fz={12.5} fw={600} c={keyCheck.ok ? '#24583a' : '#9b2c2c'}>
                  {keyCheck.text}
                </Text>
              )}
            </Group>
            <Text fz={12.5} c={colors.muted}>
              Get one at console.anthropic.com. Claude also searches the web when your slides don't cover a question.
            </Text>
          </Stack>
        </SimpleGrid>
      </Section>

      <Section label="Voice">
        <SimpleGrid cols={{ base: 1, md: 2 }} spacing={18}>
          <HotkeyInput
            label="Ask hotkey"
            hint="Click the field, then press your shortcut."
            value={form.ask_hotkey}
            onChange={(v) => set('ask_hotkey', v)}
          />
          <HotkeyInput
            label="Explain-this-slide hotkey"
            hint="Flick explains the slide on screen to the audience, out loud."
            value={form.explain_hotkey}
            onChange={(v) => set('explain_hotkey', v)}
            error={sameHotkeys ? 'Use a different shortcut from the Ask hotkey.' : null}
          />
          <Select
            size="md"
            label="Hotkey mode"
            data={[
              { value: 'toggle', label: 'Toggle: press to start, press again to stop' },
              { value: 'push-to-talk', label: 'Hold to talk' },
            ]}
            value={form.hotkey_mode}
            onChange={(v) => v && set('hotkey_mode', v as Form['hotkey_mode'])}
            allowDeselect={false}
          />
          <Select
            size="md"
            label="Speech model (runs on this computer)"
            data={[
              { value: 'base', label: 'base: fastest, less accurate' },
              { value: 'small', label: 'small: balanced (recommended)' },
              { value: 'medium', label: 'medium: most accurate, best for Urdu' },
            ]}
            value={form.speech_model}
            onChange={(v) => v && set('speech_model', v)}
            allowDeselect={false}
          />
          <Select
            size="md"
            label="Spoken language"
            data={[
              { value: 'en', label: 'English (also best for Roman Urdu)' },
              { value: 'ur', label: 'Urdu' },
              { value: 'auto', label: 'Auto-detect' },
            ]}
            value={form.language}
            onChange={(v) => v && set('language', v)}
            allowDeselect={false}
          />
        </SimpleGrid>
        <Checkbox
          mt={18}
          label="Show the floating mic button"
          checked={form.show_mic}
          onChange={(e) => set('show_mic', e.currentTarget.checked)}
          color="aqua.6"
        />
      </Section>

      <Group justify="flex-end" gap={10}>
        <Button
          size="md"
          variant="default"
          disabled={Object.keys(changes).length === 0 || saving}
          onClick={() => {
            setForm(toForm(saved));
            setNewKey(saved.has_api_key ? null : '');
          }}
        >
          Cancel
        </Button>
        <Button size="md" leftSection={<IconCheck size={18} />} loading={saving} disabled={!canSave} onClick={save}>
          Save settings
        </Button>
      </Group>
    </Stack>
  );
}

function Section({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Card>
      <Text fz={12} fw={700} c={colors.muted} tt="uppercase" mb={14} style={{ letterSpacing: 0.8 }}>
        {label}
      </Text>
      <Box>{children}</Box>
    </Card>
  );
}
