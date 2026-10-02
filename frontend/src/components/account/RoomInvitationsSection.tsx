import { Button, Text } from '@mantine/core';
import { useTranslation } from 'react-i18next';
import { useAcceptInvitation } from '../../hooks/useRooms';
import { useDeclineInvitation, useMyInvitations } from '../../hooks/useInvitations';
import { userDisplayName } from '../../lib/members';
import { notifyError, notifySuccess } from '../../lib/notify';
import { AccountSection } from './AccountSection';
import { FriendRow } from '../friends/FriendRow';

/**
 * FR-F5: Room invitations a Friend sent the signed-in user, each to accept
 * (joining with the proposed role) or decline (silently). Renders nothing
 * while there are none, so the Account page only grows when there is
 * something to answer.
 */
export function RoomInvitationsSection() {
  const { t } = useTranslation();
  const invitations = useMyInvitations(true);
  const accept = useAcceptInvitation();
  const decline = useDeclineInvitation();

  if (!invitations.data || invitations.data.length === 0) {
    return null;
  }

  return (
    <AccountSection
      title={t('account.invitations.title')}
      description={t('account.invitations.description')}
    >
      {invitations.data.map((invitation) => (
        <FriendRow
          key={invitation.code}
          user={invitation.invitedBy}
          detail={
            <Text size="xs" c="dimmed">
              <Text span inherit fw={600} c="var(--text-primary)">
                {invitation.room.name}
              </Text>
              {' · '}
              {t('account.invitations.from', {
                name: userDisplayName(invitation.invitedBy),
                role: t(`roles.${invitation.role}`),
              })}
            </Text>
          }
        >
          <Button
            size="xs"
            loading={accept.isPending && accept.variables === invitation.code}
            onClick={() =>
              accept.mutate(invitation.code, {
                onSuccess: (room) =>
                  notifySuccess(t('account.invitations.joined', { room: room.name })),
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
            loading={decline.isPending && decline.variables === invitation.code}
            onClick={() => decline.mutate(invitation.code, { onError: notifyError })}
          >
            {t('common.decline')}
          </Button>
        </FriendRow>
      ))}
    </AccountSection>
  );
}
