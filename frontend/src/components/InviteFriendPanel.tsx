import { useState } from 'react';
import { Button, Select, Stack, Text } from '@mantine/core';
import { PaperPlaneTiltIcon } from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';
import { useFriends } from '../hooks/useFriends';
import { useMembers } from '../hooks/useMembers';
import { useCreateDirectInvitation } from '../hooks/useInvitations';
import { userDisplayName } from '../lib/members';
import { notifyError, notifySuccess } from '../lib/notify';
import type { Friend } from '../types/friend';
import type { RoomRole } from '../types/room';

/** A Friend's option label: their name, with the email when the backend sends one. */
function friendOptionLabel(friend: Friend): string {
  const name = userDisplayName(friend);
  return friend.email && friend.email !== name ? `${name} (${friend.email})` : name;
}

/**
 * The invite modal's "Friends" tab (FR-F5, spec 18_2): picks a Friend who
 * isn't in the Room yet and a proposed role. The Friend joins only after
 * accepting from their Account page; inviting them again replaces the open
 * invitation.
 */
export function InviteFriendPanel({ roomId }: { roomId: string }) {
  const { t } = useTranslation();
  const friends = useFriends(true);
  const members = useMembers(roomId, true);
  const invite = useCreateDirectInvitation(roomId);
  const [friendId, setFriendId] = useState<string | null>(null);
  const [role, setRole] = useState<RoomRole>('player');

  // Both lists are needed to know who is still invitable: until the members
  // arrive, a Friend already in the Room could otherwise be offered.
  const ready = Boolean(friends.data && members.data);
  const candidates =
    friends.data && members.data
      ? friends.data.friends.filter(
          (friend) => !members.data.some((member) => member.userId === friend.userId),
        )
      : [];
  const chosen = candidates.find((friend) => friend.userId === friendId);

  if (friends.isError) {
    return <Text c="red">{t('account.friends.loadError')}</Text>;
  }

  if (members.isError) {
    return <Text c="red">{t('members.loadError')}</Text>;
  }

  if (ready && candidates.length === 0) {
    return (
      <Text size="sm" c="dimmed">
        {t('invite.noFriends')}
      </Text>
    );
  }

  const handleSend = (friend: Friend) => {
    invite.mutate(
      { userId: friend.userId, role },
      {
        onSuccess: () => {
          notifySuccess(t('invite.sent', { name: userDisplayName(friend) }));
          setFriendId(null);
        },
        onError: notifyError,
      },
    );
  };

  return (
    <Stack gap="sm">
      <Text size="sm" c="dimmed">
        {t('invite.friendsHint')}
      </Text>
      <Select
        label={t('invite.friend')}
        placeholder={t('invite.friendPlaceholder')}
        data={candidates.map((friend) => ({
          value: friend.userId,
          label: friendOptionLabel(friend),
        }))}
        value={friendId}
        onChange={setFriendId}
        searchable
        disabled={!ready}
      />
      <Select
        label={t('invite.proposedRole')}
        data={[
          { value: 'player', label: t('roles.player') },
          { value: 'master', label: t('roles.master') },
        ]}
        value={role}
        onChange={(value) => value && setRole(value as RoomRole)}
        allowDeselect={false}
      />
      <Button
        leftSection={<PaperPlaneTiltIcon size={16} />}
        disabled={!chosen}
        loading={invite.isPending}
        onClick={() => chosen && handleSend(chosen)}
      >
        {t('invite.send')}
      </Button>
    </Stack>
  );
}
