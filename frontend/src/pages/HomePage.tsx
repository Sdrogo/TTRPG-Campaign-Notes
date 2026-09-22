import { Stack, Title, Text, Button, Loader } from '@mantine/core';
import { BookOpenIcon, GoogleLogoIcon } from '@phosphor-icons/react';
import { supabase } from '../lib/supabaseClient';
import { useSession } from '../hooks/useSession';
import { AppHeader } from '../components/AppHeader';
import { RoomsPage } from './RoomsPage';

export function HomePage() {
  const { session, loading: sessionLoading } = useSession();

  const signInWithGoogle = () => {
    // Come back to whatever origin we're on (production, a Vercel preview,
    // or localhost) instead of Supabase's single configured Site URL. Each
    // origin must be listed in Supabase's Redirect URLs allowlist.
    void supabase.auth.signInWithOAuth({
      provider: 'google',
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
      <Stack align="center" justify="center" gap="md" style={{ minHeight: '100svh' }}>
        <BookOpenIcon size={48} weight="duotone" color="var(--text-muted)" />
        <Title order={1} ta="center" style={{ fontFamily: 'var(--font-display)' }}>
          TTRPG Campaign Notes
        </Title>
        <Text c="dimmed" ta="center">
          Accedi per continuare.
        </Text>
        <Button leftSection={<GoogleLogoIcon size={20} />} onClick={signInWithGoogle}>
          Accedi con Google
        </Button>
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
