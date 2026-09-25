import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Burger, Group, Title, UnstyledButton } from '@mantine/core';
import { AccountButton } from './account/AccountButton';
import { LanguageSelector } from './LanguageSelector';
import { GlossaryIndexDrawer } from './GlossaryIndexDrawer';
import { useTranslation } from 'react-i18next';

interface AppHeaderProps {
  /** Given on a Room-scoped page, this shows a burger toggling the Room's
   *  Glossary/Tag index sidebar (spec `10 - UX Refinment`). Omitted elsewhere
   *  (the Rooms list, the Account page), where there is no Room to index. */
  roomId?: string;
}

/**
 * The top navigation bar shown on every signed-in page: app name (back to the
 * Rooms list) on the left; on the right the Glossary Index toggle (Room pages
 * only), the language flag, then the account avatar (spec 09, spec 10).
 */
export function AppHeader({ roomId }: AppHeaderProps) {
  const { t } = useTranslation();
  const [glossaryOpened, setGlossaryOpened] = useState(false);

  return (
    <>
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
          {roomId && (
            <Burger
              opened={glossaryOpened}
              onClick={() => setGlossaryOpened((current) => !current)}
              size="sm"
              aria-label={glossaryOpened ? t('glossary.closeToggle') : t('glossary.openToggle')}
            />
          )}
          <LanguageSelector />
          <AccountButton />
        </Group>
      </Group>
      {roomId && (
        <GlossaryIndexDrawer
          roomId={roomId}
          opened={glossaryOpened}
          onClose={() => setGlossaryOpened(false)}
        />
      )}
    </>
  );
}
