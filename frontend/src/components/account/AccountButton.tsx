import { Link, useLocation } from 'react-router-dom';
import { Tooltip, UnstyledButton } from '@mantine/core';
import { UserAvatar } from '../UserAvatar';
import { useAccount } from '../../hooks/useAccount';
import { useTranslation } from 'react-i18next';

/** The circular avatar at the top right of every page: opens the Account page. */
export function AccountButton() {
  const { t } = useTranslation();
  const account = useAccount(true);
  const active = useLocation().pathname === '/account';

  return (
    <Tooltip label={t('header.account')} withArrow position="bottom-end">
      <UnstyledButton
        component={Link}
        to="/account"
        aria-label={t('header.account')}
        aria-current={active ? 'page' : undefined}
        className="account-button"
        data-active={active || undefined}
      >
        <UserAvatar user={account.data} size={36} />
      </UnstyledButton>
    </Tooltip>
  );
}
