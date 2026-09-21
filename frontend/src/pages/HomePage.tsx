import { Stack, Title, Text, Button, Loader, Code } from '@mantine/core';
import { BookOpen, GoogleLogo } from '@phosphor-icons/react';
import { supabase } from '../lib/supabaseClient';
import { useSession } from '../hooks/useSession';
import { useCurrentUser } from '../hooks/useCurrentUser';

export function HomePage() {
  const { session, loading: sessionLoading } = useSession();
  const currentUser = useCurrentUser(Boolean(session));

  const signInWithGoogle = () => {
    void supabase.auth.signInWithOAuth({ provider: 'google' });
  };

  const signOut = () => {
    void supabase.auth.signOut();
  };

  return (
    <Stack align="center" justify="center" gap="md" style={{ minHeight: '100svh' }}>
      <BookOpen size={48} weight="duotone" color="var(--text-muted)" />
      <Title order={1} ta="center">
        TTRPG Campaign Notes
      </Title>

      {sessionLoading && <Loader color="accent" />}

      {!sessionLoading && !session && (
        <>
          <Text c="dimmed" ta="center">
            Accedi per continuare.
          </Text>
          <Button leftSection={<GoogleLogo size={20} />} onClick={signInWithGoogle}>
            Accedi con Google
          </Button>
        </>
      )}

      {!sessionLoading && session && (
        <>
          <Text ta="center">Sessione attiva: {session.user.email}</Text>
          {currentUser.isLoading && <Text c="dimmed">Verifica lato backend in corso…</Text>}
          {currentUser.isError && (
            <Text c="red">Errore nella verifica backend: {String(currentUser.error)}</Text>
          )}
          {currentUser.data && (
            <Code block>{JSON.stringify(currentUser.data, null, 2)}</Code>
          )}
          <Button variant="outline" onClick={signOut}>
            Esci
          </Button>
        </>
      )}
    </Stack>
  );
}
