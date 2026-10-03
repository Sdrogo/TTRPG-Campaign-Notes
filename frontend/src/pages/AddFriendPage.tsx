import { useEffect, useRef } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Button, Group, Loader, Stack, Text, Title } from '@mantine/core';
import { useTranslation } from 'react-i18next';
import { useSession } from '../hooks/useSession';
import { useSendFriendRequest } from '../hooks/useFriends';
import { clearPendingFriendCode, savePendingFriendCode } from '../lib/pendingInvite';
import { FullPageLoader, SignInRequired } from '../components/PageState';

/**
 * `/friends/add/:code` (FR-F4, spec 18_2): someone's friend link. Sends them
 * a friend request as soon as the user is signed in, like an invite link
 * joins a Room. The backend's message explains a refusal (your own link,
 * already Friends, a request already pending, an unknown code).
 */
export function AddFriendPage() {
  const { t } = useTranslation();
  const { code } = useParams<{ code: string }>();
  const { session, loading: sessionLoading } = useSession();
  const sendRequest = useSendFriendRequest();
  const triggered = useRef(false);

  useEffect(() => {
    if (session && code && !triggered.current) {
      triggered.current = true;
      clearPendingFriendCode();
      sendRequest.mutate({ code });
    }
  }, [session, code, sendRequest]);

  // Signing in sends the user back to the site root, so remember the code and
  // let the home page bring them back here.
  useEffect(() => {
    if (!sessionLoading && !session && code) {
      savePendingFriendCode(code);
    }
  }, [sessionLoading, session, code]);

  if (sessionLoading) {
    return <FullPageLoader />;
  }

  if (!session) {
    return <SignInRequired>{t('friendLink.signInRequired')}</SignInRequired>;
  }

  // Without a chosen name (the email is never sent) the request is confirmed
  // without naming anyone rather than as "unknown user".
  const name = sendRequest.data?.displayName;

  return (
    <Stack align="center" justify="center" gap="md" p="md" style={{ minHeight: '100svh' }}>
      {sendRequest.isPending && <Loader color="accent" />}
      {sendRequest.isError && (
        <>
          <Title order={2} ta="center" style={{ fontFamily: 'var(--font-display)' }}>
            {t('friendLink.failed')}
          </Title>
          <Text c="red" ta="center">
            {sendRequest.error.message}
          </Text>
        </>
      )}
      {sendRequest.isSuccess && (
        <Title order={2} ta="center" style={{ fontFamily: 'var(--font-display)' }}>
          {name ? t('friendLink.sent', { name }) : t('friendLink.sentAnonymous')}
        </Title>
      )}
      {(sendRequest.isError || sendRequest.isSuccess) && (
        <Group justify="center">
          <Button component={Link} to="/account">
            {t('friendLink.goToAccount')}
          </Button>
          <Button component={Link} to="/" variant="default">
            {t('common.backToMyRooms')}
          </Button>
        </Group>
      )}
    </Stack>
  );
}
