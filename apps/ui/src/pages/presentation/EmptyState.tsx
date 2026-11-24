// Issue #4 · Design screen: D1 Presentation · Empty
//
// "Upload .pptx" (or drop a file) and "Use open PowerPoint".
// Backend: POST /decks/upload, POST /decks/from-powerpoint
import { Box, Button, Card, Group, Stack, Text, ThemeIcon } from '@mantine/core';
import { Dropzone } from '@mantine/dropzone';
import { IconKey, IconPresentation, IconUpload } from '@tabler/icons-react';
import { useNavigate } from 'react-router-dom';
import { colors } from '../../theme';
import { useDeckLoader } from './useDeckLoader';

const PPTX_MIME = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';

export function EmptyState({ hasApiKey, onLoaded }: { hasApiKey: boolean; onLoaded: () => void }) {
  const navigate = useNavigate();
  const loader = useDeckLoader(onLoaded);

  return (
    <Stack gap={24}>
      {!hasApiKey && (
        <Box p={20} style={{ background: '#fbe3d6', border: '1px solid #f3cdb8', borderRadius: 16 }}>
          <Group align="flex-start" wrap="nowrap" gap={14}>
            <ThemeIcon size={40} radius={10} variant="white" c="#8a4220">
              <IconKey size={20} />
            </ThemeIcon>
            <Stack gap={6}>
              <Text fw={700} c="#6e3416">
                Add your Claude API key to get started
              </Text>
              <Text fz={13.5} c="#6e3416">
                Flick needs it to prepare and answer questions. Claude can also search the web, so no other key is
                needed.
              </Text>
              <Button variant="default" size="sm" w="fit-content" onClick={() => navigate('/settings')}>
                Open Settings
              </Button>
            </Stack>
          </Group>
        </Box>
      )}

      <Card>
        <Dropzone
          onDrop={(files) => loader.uploadFile(files[0] ?? null)}
          onReject={() => loader.uploadFile(null)}
          accept={{ [PPTX_MIME]: ['.pptx'] }}
          multiple={false}
          activateOnClick={false}
          loading={loader.busy === 'file'}
          p={36}
          radius={14}
          style={{ border: `2px dashed ${colors.border}`, background: colors.soft }}
        >
          <Stack align="center" gap={12} style={{ pointerEvents: 'all' }}>
            <ThemeIcon size={56} radius={14} variant="white" c={colors.plum} style={{ border: `1px solid ${colors.border}` }}>
              <IconPresentation size={26} />
            </ThemeIcon>
            <Text fz={18} fw={700} c={colors.ink}>
              No presentation loaded
            </Text>
            <Text fz={14} c={colors.muted} ta="center" maw={380}>
              Load your .pptx and Flick reads every slide and speaker note, then predicts the questions your audience
              is likely to ask.
            </Text>
            <Group gap={10} mt={6} justify="center">
              <Button
                size="md"
                leftSection={<IconUpload size={18} />}
                loading={loader.busy === 'file'}
                disabled={loader.busy !== null}
                onClick={() => pickFile(loader.uploadFile)}
              >
                Upload .pptx
              </Button>
              <Button
                size="md"
                variant="default"
                leftSection={<IconPresentation size={18} />}
                loading={loader.busy === 'powerpoint'}
                disabled={loader.busy !== null}
                onClick={loader.loadFromPowerPoint}
              >
                Use open PowerPoint
              </Button>
            </Group>
            <Text fz={12.5} c={colors.muted}>
              or drop a .pptx file here
            </Text>
          </Stack>
        </Dropzone>
      </Card>
    </Stack>
  );
}

/** Opens the file picker for a .pptx. */
export function pickFile(onFile: (file: File | null) => void) {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.pptx';
  input.onchange = () => onFile(input.files?.[0] ?? null);
  input.click();
}
