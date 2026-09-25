import { useEffect, useRef } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { Stack, Title, Text, Button, Loader } from '@mantine/core';
import { useSession } from '../hooks/useSession';
import { useAcceptInvitation } from '../hooks/useRooms';
import { useTranslation } from 'react-i18next';

/**
 * `/invite/:code`: accepts the invitation as soon as the user is signed in,
 * then opens the Room. An invalid, expired or used code shows an error.
 */
export function AcceptInvitePage() {
  const { t } = useTranslation();
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
        <Text>{t('invite.signInRequired')}</Text>
        <Button component={Link} to="/">
          {t('common.goToLogin')}
        </Button>
      </Stack>
    );
  }

  return (
    <Stack align="center" justify="center" gap="md" style={{ minHeight: '100svh' }}>
      {acceptInvitation.isPending && <Loader color="accent" />}
      {acceptInvitation.isError && (
        <>
          <Text c="red">{t('invite.invalid')}</Text>
          <Button component={Link} to="/">
            {t('common.backToMyRooms')}
          </Button>
        </>
      )}
      {acceptInvitation.isSuccess && acceptInvitation.data && (
        <>
          <Title order={2} style={{ fontFamily: 'var(--font-display)' }}>
            {t('invite.joined', { room: acceptInvitation.data.name })}
          </Title>
          <Button onClick={() => navigate('/')}>{t('invite.goToMyRooms')}</Button>
        </>
      )}
    </Stack>
  );
}
