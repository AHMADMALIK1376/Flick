// Main window frame: sidebar on the left, the current page on the right.
import { AppShell, Box, Group, NavLink, Stack, Text } from '@mantine/core';
import { IconListDetails, IconMessages, IconPresentation, IconSettings } from '@tabler/icons-react';
import { NavLink as RouterLink, Outlet, useLocation } from 'react-router-dom';
import { colors } from '../theme';
import { Logo } from './Logo';
import { ConnectionStatus } from './ConnectionStatus';

const NAV = [
  { to: '/presentation', label: 'Presentation', icon: IconPresentation },
  { to: '/questions', label: 'Prepared Questions', icon: IconListDetails },
  { to: '/log', label: 'Q&A Log', icon: IconMessages },
  { to: '/settings', label: 'Settings', icon: IconSettings },
];

export function AppLayout() {
  const { pathname } = useLocation();

  return (
    <AppShell navbar={{ width: 240, breakpoint: 0 }} padding="xl">
      <AppShell.Navbar p="md" style={{ background: colors.sidebar, borderRight: `1px solid ${colors.border}` }}>
        <Stack justify="space-between" h="100%">
          <Box>
            <Group px="xs" py="md">
              <Logo size={30} />
            </Group>
            <Stack gap={4} mt="md">
              {NAV.map(({ to, label, icon: Icon }) => (
                <NavLink
                  key={to}
                  component={RouterLink}
                  to={to}
                  label={label}
                  leftSection={<Icon size={18} stroke={1.8} />}
                  active={pathname.startsWith(to)}
                  variant="filled"
                  styles={{ root: { borderRadius: 10 } }}
                />
              ))}
            </Stack>
          </Box>
          <Box px="xs">
            <ConnectionStatus />
            <Text size="xs" c={colors.muted} mt={6}>
              Flick v0.1
            </Text>
          </Box>
        </Stack>
      </AppShell.Navbar>

      <AppShell.Main style={{ background: colors.background }}>
        <Outlet />
      </AppShell.Main>
    </AppShell>
  );
}
