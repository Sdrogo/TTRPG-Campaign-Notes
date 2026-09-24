import { Link } from 'react-router-dom';
import { Group, Title, UnstyledButton } from '@mantine/core';
import { AccountButton } from './account/AccountButton';
import { LanguageSelector } from './LanguageSelector';
import { useTranslation } from 'react-i18next';

/**
 * The top navigation bar shown on every signed-in page: app name (back to the
 * Rooms list) on the left; on the right the language flag, then the account
 * avatar (spec 09).
 */
export function AppHeader() {
  const { t } = useTranslation();
  return (
    <Group
      component="header"
      justify="space-between"
      wrap="nowrap"
      px={{ base: 'sm', sm: 'lg', lg: 'xl' }}
      py="sm"
      style={{ borderBottom: '1px solid var(--border-default)' }}
    >
      <UnstyledButton component={Link} to="/" style={{ minWidth: 0 }}>
        <Title order={3} lineClamp={1} style={{ fontFamily: 'var(--font-display)' }}>
          {t('app.name')}
        </Title>
      </UnstyledButton>
      <Group gap="xs" wrap="nowrap" style={{ flexShrink: 0 }}>
        <LanguageSelector />
        <AccountButton />
      </Group>
    </Group>
  );
}
