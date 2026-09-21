import { useEffect, useRef } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { Stack, Title, Text, Button, Loader } from '@mantine/core';
import { useSession } from '../hooks/useSession';
import { useAcceptInvitation } from '../hooks/useRooms';

export function AcceptInvitePage() {
  const { code } = useParams<{ code: string }>();
  const navigate = useNavigate();
  const { session, loading: sessionLoading } = useSession();
  const acceptInvitation = useAcceptInvitation();
  const triggered = useRef(false);

  useEffect(() => {
    if (session && code && !triggered.current) {
      triggered.current = true;
      acceptInvitation.mutate(code);
    }
  }, [session, code, acceptInvitation]);

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
        <Text>Accedi per unirti a questa Stanza.</Text>
        <Button component={Link} to="/">
          Vai al login
        </Button>
      </Stack>
    );
  }

  return (
    <Stack align="center" justify="center" gap="md" style={{ minHeight: '100svh' }}>
      {acceptInvitation.isPending && <Loader color="accent" />}
      {acceptInvitation.isError && (
        <>
          <Text c="red">Invito non valido, scaduto o già utilizzato.</Text>
          <Button component={Link} to="/">
            Torna alle mie Stanze
          </Button>
        </>
      )}
      {acceptInvitation.isSuccess && acceptInvitation.data && (
        <>
          <Title order={2} style={{ fontFamily: 'var(--font-display)' }}>
            Ti sei unito a "{acceptInvitation.data.name}"
          </Title>
          <Button onClick={() => navigate('/')}>Vai alle mie Stanze</Button>
        </>
      )}
    </Stack>
  );
}
