// The Claude model, chosen from the sidebar: Haiku 5.5 (fast, cheap), Sonnet 5.5 or Opus 5.5.
// Saved at once (PATCH /settings) and used from the next question. The Settings page and this
// picker keep each other in step with a "flick:model" window event.
import { Box, Group, Select, Text } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconSparkles } from '@tabler/icons-react';
import { useEffect, useState } from 'react';
import { api } from '../api/flick';
import type { ModelOption } from '../api/types';
import { colors } from '../theme';

export const MODEL_EVENT = 'flick:model';

/** Tell the other model pickers in this window that the model changed. */
export function announceModel(model: string) {
  window.dispatchEvent(new CustomEvent(MODEL_EVENT, { detail: model }));
}

export function ModelPicker() {
  const [models, setModels] = useState<ModelOption[]>([]);
  const [model, setModel] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    Promise.all([api.models(), api.getSettings()])
      .then(([list, settings]) => {
        setModels(list);
        setModel(settings.model);
      })
      .catch(() => undefined); // backend not up yet: the picker stays empty
    const onChange = (e: Event) => setModel((e as CustomEvent<string>).detail);
    window.addEventListener(MODEL_EVENT, onChange);
    return () => window.removeEventListener(MODEL_EVENT, onChange);
  }, []);

  async function choose(next: string | null) {
    if (!next || next === model) return;
    const before = model;
    setModel(next);
    setSaving(true);
    try {
      await api.updateSettings({ model: next });
      announceModel(next);
      const picked = models.find((m) => m.id === next);
      notifications.show({ color: 'plum', message: `Flick now uses ${picked?.name ?? next}.` });
    } catch (err) {
      setModel(before);
      notifications.show({ color: 'red', message: err instanceof Error ? err.message : 'Could not change the model.' });
    } finally {
      setSaving(false);
    }
  }

  const current = models.find((m) => m.id === model);

  return (
    <Box px="xs" mb={14}>
      <Group gap={6} mb={6}>
        <IconSparkles size={14} color={colors.plum} />
        <Text fz={12} fw={700} c={colors.muted} tt="uppercase" style={{ letterSpacing: 0.4 }}>
          Claude model
        </Text>
      </Group>
      <Select
        aria-label="Claude model"
        data={models.map((m) => ({ value: m.id, label: m.short ?? m.name }))}
        value={model}
        onChange={choose}
        allowDeselect={false}
        disabled={!models.length || saving}
        placeholder="Loading…"
        radius="md"
        comboboxProps={{ withinPortal: true, position: 'top-start', width: 270 }}
        renderOption={({ option, checked }) => {
          const m = models.find((x) => x.id === option.value);
          return (
            <Box py={2}>
              <Group justify="space-between" gap={8} wrap="nowrap">
                <Text fz={14} fw={checked ? 800 : 700} c={colors.ink}>
                  {m?.name ?? option.label}
                </Text>
                {m?.price && (
                  <Text fz={11.5} c={colors.muted} style={{ whiteSpace: 'nowrap' }}>
                    {m.price}
                  </Text>
                )}
              </Group>
              {m?.hint && (
                <Text fz={12} c={colors.muted} lh={1.35}>
                  {m.hint}
                </Text>
              )}
            </Box>
          );
        }}
      />
      {current?.hint && (
        <Text fz={11.5} c={colors.muted} mt={6} lh={1.4}>
          {current.hint}
          {current.price ? ` ${current.price} per million tokens (in / out).` : ''}
        </Text>
      )}
    </Box>
  );
}
