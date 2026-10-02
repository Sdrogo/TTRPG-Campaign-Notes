import { Link, useLocation } from 'react-router-dom';
import { Indicator, Tooltip, UnstyledButton } from '@mantine/core';
import { UserAvatar } from '../UserAvatar';
import { useAccount } from '../../hooks/useAccount';
import { useFriends } from '../../hooks/useFriends';
import { useMyInvitations } from '../../hooks/useInvitations';
import { useTranslation } from 'react-i18next';

/**
 * The circular avatar at the top right of every page: opens the Account page.
 * A badge counts what waits there for an answer, friend requests received and
 * Room invitations from Friends (spec 18_2). No real-time updates (D-04): the
 * count refreshes when the window regains focus, like every query.
 */
export function AccountButton() {
  const { t } = useTranslation();
  const account = useAccount(true);
  const friends = useFriends(true);
  const invitations = useMyInvitations(true);
  const active = useLocation().pathname === '/account';
  const pending = (friends.data?.incoming.length ?? 0) + (invitations.data?.length ?? 0);
  const label = pending > 0 ? t('header.accountPending', { count: pending }) : t('header.account');

  return (
    <Tooltip label={label} withArrow position="bottom-end">
      <UnstyledButton
        component={Link}
        to="/account"
        aria-label={label}
        aria-current={active ? 'page' : undefined}
        className="account-button"
        data-active={active || undefined}
      >
        <Indicator
          label={pending}
          disabled={pending === 0}
          size={18}
          offset={4}
          color="accent"
        >
          <UserAvatar user={account.data} size={36} />
        </Indicator>
      </UnstyledButton>
    </Tooltip>
  );
}
