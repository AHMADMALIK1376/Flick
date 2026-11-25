// The language Flick talks in: English, Urdu, or Urdu + English mixed (the way Pakistani teachers
// explain in class). One setting for the whole app (saved at once); every picker stays in step.
import { Box, Group, SegmentedControl, Text } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { useEffect, useState } from 'react';
import { api } from '../api/flick';
import type { TalkLanguage } from '../api/types';

export const LANGUAGE_EVENT = 'flick:talk-language';

export const LANGUAGES: { value: TalkLanguage; label: string; hint: string }[] = [
  { value: 'en', label: 'English', hint: 'Flick explains and answers in English.' },
  { value: 'ur', label: 'Urdu', hint: 'Flick explains and answers in Urdu, with the usual English terms kept in English.' },
  {
    value: 'mix',
    label: 'Urdu + English',
    hint: 'A natural mix of Urdu and English, the way teachers in Pakistan explain in class.',
  },
];

export function languageName(value: string | null | undefined): string {
  return { en: 'English', ur: 'Urdu', mix: 'Urdu + English' }[value ?? 'en'] ?? 'English';
}

/** The saved language, kept in step across the app. */
export function useTalkLanguage(): [TalkLanguage | null, (next: TalkLanguage) => Promise<void>] {
  const [language, setLanguage] = useState<TalkLanguage | null>(null);
  useEffect(() => {
    api
      .getSettings()
      .then((s) => setLanguage(s.talk_language ?? 'en'))
      .catch(() => setLanguage('en'));
    const onChange = (e: Event) => setLanguage((e as CustomEvent<TalkLanguage>).detail);
    window.addEventListener(LANGUAGE_EVENT, onChange);
    return () => window.removeEventListener(LANGUAGE_EVENT, onChange);
  }, []);

  async function choose(next: TalkLanguage) {
    const before = language;
    setLanguage(next);
    try {
      await api.updateSettings({ talk_language: next });
      window.dispatchEvent(new CustomEvent(LANGUAGE_EVENT, { detail: next }));
    } catch (err) {
      setLanguage(before);
      notifications.show({ color: 'red', message: err instanceof Error ? err.message : 'Could not change the language.' });
    }
  }
  return [language, choose];
}

export function LanguagePicker({ dark = false }: { dark?: boolean }) {
  const [language, choose] = useTalkLanguage();
  const hint = LANGUAGES.find((l) => l.value === language)?.hint;
  return (
    <Box mt={12}>
      <Group gap={10} wrap="wrap" align="center">
        <Text fz={13} fw={700} c={dark ? '#fff' : undefined}>
          Language
        </Text>
        <SegmentedControl
          size="xs"
          radius="md"
          value={language ?? 'en'}
          onChange={(v) => void choose(v as TalkLanguage)}
          disabled={language === null}
          data={LANGUAGES.map(({ value, label }) => ({ value, label }))}
          aria-label="Language Flick talks in"
          styles={
            dark
              ? { root: { background: 'rgba(255,255,255,0.14)' }, label: { color: '#fff' }, indicator: { background: 'rgba(255,255,255,0.28)' } }
              : undefined
          }
        />
      </Group>
      {hint && (
        <Text fz={12.5} c={dark ? 'rgba(255,255,255,0.78)' : 'dimmed'} mt={6}>
          {hint}
        </Text>
      )}
    </Box>
  );
}
