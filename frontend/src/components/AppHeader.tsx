import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Burger, Button, Group, Title, UnstyledButton } from '@mantine/core';
import { ArrowLeftIcon } from '@phosphor-icons/react';
import { AccountButton } from './account/AccountButton';
import { LanguageSelector } from './LanguageSelector';
import { GlossaryIndexDrawer } from './GlossaryIndexDrawer';
import { useTranslation } from 'react-i18next';

interface AppHeaderProps {
  /** Given on a Room-scoped page, this shows a burger toggling the Room's
   *  Glossary/Tag index sidebar (spec `10 - UX Refinment`). Omitted elsewhere
   *  (the Rooms list, the Account page), where there is no Room to index. */
  roomId?: string;
  /** Given on any nested page, this shows a "back" button next to the burger
   *  position. Omitted on the Rooms list (`HomePage`), which is the app's own
   *  root and has nowhere to go back to. */
  backTo?: string;
  backLabel?: string;
}

/**
 * Whether there is an entry in *this app's own* browser history to go back
 * to. `window.history.state.idx` is set by the browser history React Router
 * (`BrowserRouter`) uses - `0` for the very first entry it created, so a
 * value greater than that means at least one in-app navigation happened
 * before this page.
 */
function hasAppHistory(): boolean {
  const idx = (window.history.state as { idx?: number } | null)?.idx;
  return typeof idx === 'number' && idx > 0;
}

/**
 * The top navigation bar shown on every signed-in page: the back button and,
 * on a Room page, the Glossary Index burger, on the left; the app name (also
 * back to the Rooms list) in the middle; on the right the language flag, then
 * the account avatar (spec 09, spec 10).
 */
export function AppHeader({ roomId, backTo, backLabel }: AppHeaderProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [glossaryOpened, setGlossaryOpened] = useState(false);

  const handleBack = (destination: string) => {
    if (hasAppHistory()) {
      navigate(-1);
    } else {
      navigate(destination);
    }
  };

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
        <Group gap="xs" wrap="nowrap" style={{ flexShrink: 0 }}>
          {roomId && (
            <Burger
              opened={glossaryOpened}
              onClick={() => setGlossaryOpened((current) => !current)}
              size="sm"
              aria-label={glossaryOpened ? t('glossary.closeToggle') : t('glossary.openToggle')}
            />
          )}
          {backTo && (
            <Button
              onClick={() => handleBack(backTo)}
              variant="subtle"
              leftSection={<ArrowLeftIcon size={16} />}
            >
              {backLabel}
            </Button>
          )}
        </Group>
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
