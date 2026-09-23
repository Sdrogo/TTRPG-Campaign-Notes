import { Link } from 'react-router-dom';
import { Group, Title, UnstyledButton } from '@mantine/core';
import { AccountButton } from './account/AccountButton';

/**
 * The top navigation bar shown on every signed-in page: app name (back to the
 * Rooms list) on the left, the account avatar on the right.
 */
export function AppHeader() {
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
          TTRPG Campaign Notes
        </Title>
      </UnstyledButton>
      <AccountButton />
    </Group>
  );
}
