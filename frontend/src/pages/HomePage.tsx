import { Stack, Title, Text, Button, Loader } from '@mantine/core';
import { BookOpenIcon } from '@phosphor-icons/react';
import { AUTH_PROVIDERS, type AuthProvider } from '../lib/authProviders';
import { supabase } from '../lib/supabaseClient';
import { useSession } from '../hooks/useSession';
import { AppHeader } from '../components/AppHeader';
import { RoomsPage } from './RoomsPage';

/** `/`: the sign-in screen (one button per provider), or the user's Rooms once signed in. */
export function HomePage() {
  const { session, loading: sessionLoading } = useSession();

  const signInWith = (provider: AuthProvider) => {
    // Come back to whatever origin we're on (production, a Vercel preview,
    // or localhost) instead of Supabase's single configured Site URL. Each
    // origin must be listed in Supabase's Redirect URLs allowlist.
    void supabase.auth.signInWithOAuth({
      provider: provider.id,
      options: { redirectTo: window.location.origin },
    });
  };

  if (sessionLoading) {
    return (
      <Stack align="center" justify="center" style={{ minHeight: '100svh' }}>
        <Loader color="accent" />
      </Stack>
    );
  }

  if (!session) {
    return (
      <Stack align="center" justify="center" gap="md" px="md" style={{ minHeight: '100svh' }}>
        <BookOpenIcon size={48} weight="duotone" color="var(--text-muted)" />
        <Title order={1} ta="center" style={{ fontFamily: 'var(--font-display)' }}>
          TTRPG Campaign Notes
        </Title>
        <Text c="dimmed" ta="center">
          Accedi per continuare.
        </Text>
        <Stack gap="sm" w="100%" maw={320}>
          {/* Google stays the primary action: it's the preferred login (D-07). */}
          {AUTH_PROVIDERS.map((provider) => (
            <Button
              key={provider.id}
              fullWidth
              variant={provider.id === 'google' ? 'filled' : 'default'}
              leftSection={<provider.icon size={20} />}
              onClick={() => signInWith(provider)}
            >
              Accedi con {provider.label}
            </Button>
          ))}
        </Stack>
      </Stack>
    );
  }

  return (
    <Stack gap={0}>
      <AppHeader />
      <RoomsPage />
    </Stack>
  );
}
