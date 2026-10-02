import type { ReactNode } from 'react';
import { Button, Divider, Loader, Stack, Text, Title } from '@mantine/core';
import { useTranslation } from 'react-i18next';
import {
  useAcceptFriendRequest,
  useDeclineFriendRequest,
  useFriends,
  useRemoveFriend,
} from '../../hooks/useFriends';
import { userDisplayName } from '../../lib/members';
import { notifyError, notifySuccess } from '../../lib/notify';
import { AccountSection } from './AccountSection';
import { FriendLinkField } from './FriendLinkField';
import { FriendRow } from '../friends/FriendRow';
import { RemoveFriendButton } from '../friends/RemoveFriendButton';

/** A titled list inside the Friends card. */
function FriendGroup({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Stack gap="sm">
      <Title order={3} fz="h5">
        {title}
      </Title>
      {children}
    </Stack>
  );
}

/**
 * The Account page's Friends card (FR-F2 to FR-F4, spec 18_2): the friend
 * link, requests received (Accept/Decline), the Friends themselves (Remove)
 * and requests sent (Cancel). Declining and removing are silent for the
 * other user (D-27).
 */
export function FriendsSection() {
  const { t } = useTranslation();
  const friends = useFriends(true);
  const accept = useAcceptFriendRequest();
  const decline = useDeclineFriendRequest();
  const remove = useRemoveFriend();

  /** Whether `mutation` is running for this `key` (one button per row). */
  const busy = (mutation: { isPending: boolean; variables?: string }, key: string) =>
    mutation.isPending && mutation.variables === key;

  return (
    <AccountSection title={t('account.friends.title')} description={t('account.friends.description')}>
      <FriendLinkField />
      <Divider />

      {friends.isLoading && <Loader color="accent" size="sm" />}
      {friends.isError && <Text c="red">{t('account.friends.loadError')}</Text>}
      {friends.data && (
        <Stack gap="lg">
          {friends.data.incoming.length > 0 && (
            <FriendGroup title={t('account.friends.incoming')}>
              {friends.data.incoming.map((request) => (
                <FriendRow key={request.friendshipId} user={request}>
                  <Button
                    size="xs"
                    loading={busy(accept, request.friendshipId)}
                    disabled={busy(decline, request.friendshipId)}
                    onClick={() =>
                      accept.mutate(request.friendshipId, {
                        onSuccess: (friend) =>
                          notifySuccess(
                            t('account.friends.accepted', { name: userDisplayName(friend) }),
                          ),
                        onError: notifyError,
                      })
                    }
                  >
                    {t('common.accept')}
                  </Button>
                  <Button
                    size="xs"
                    variant="subtle"
                    color="gray"
                    loading={busy(decline, request.friendshipId)}
                    disabled={busy(accept, request.friendshipId)}
                    onClick={() => decline.mutate(request.friendshipId, { onError: notifyError })}
                  >
                    {t('common.decline')}
                  </Button>
                </FriendRow>
              ))}
            </FriendGroup>
          )}

          <FriendGroup title={t('account.friends.list')}>
            {friends.data.friends.length === 0 && (
              <Text size="sm" c="dimmed">
                {t('account.friends.empty')}
              </Text>
            )}
            {friends.data.friends.map((friend) => (
              <FriendRow key={friend.friendshipId} user={friend}>
                <RemoveFriendButton
                  name={userDisplayName(friend)}
                  loading={busy(remove, friend.userId)}
                  onConfirm={() => remove.mutate(friend.userId, { onError: notifyError })}
                />
              </FriendRow>
            ))}
          </FriendGroup>

          {friends.data.outgoing.length > 0 && (
            <FriendGroup title={t('account.friends.outgoing')}>
              {friends.data.outgoing.map((request) => (
                <FriendRow key={request.friendshipId} user={request}>
                  <Button
                    size="xs"
                    variant="subtle"
                    color="gray"
                    loading={busy(remove, request.userId)}
                    onClick={() => remove.mutate(request.userId, { onError: notifyError })}
                  >
                    {t('account.friends.cancelRequest')}
                  </Button>
                </FriendRow>
              ))}
            </FriendGroup>
          )}
        </Stack>
      )}
    </AccountSection>
  );
}
