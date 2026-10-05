import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ActionIcon, Box, Burger, Group, Title, UnstyledButton } from '@mantine/core';
import { useHeadroom } from '@mantine/hooks';
import { ArrowLeftIcon } from '@phosphor-icons/react';
import { ViewAsBanner } from './ViewAsBanner';
import { useViewAs } from '../hooks/useViewAs';
import { AccountButton } from './account/AccountButton';
import { LanguageSelector } from './LanguageSelector';
import { SearchButton } from './search/SearchButton';
import { GlossaryIndexDrawer } from './GlossaryIndexDrawer';
import { useTranslation } from 'react-i18next';

interface AppHeaderProps {
  /** Given on a Room-scoped page, this shows a burger toggling the Room's
   *  Glossary/Tag index sidebar (spec `10 - UX Refinment`) and the Room's
   *  search (spec 21). Omitted elsewhere (the Rooms list, the Account page),
   *  where there is no Room to index or search. */
  roomId?: string;
  /** Given on any nested page, this shows a "back" arrow (icon only, named
   *  by `backLabel` for screen readers) before the burger. Omitted on the
   *  Rooms list (`HomePage`), which is the app's own root and has nowhere to
   *  go back to. */
  backTo?: string;
  backLabel?: string;
}

// How far down the page the bar stays put whatever the scroll direction: about
// its own height, so it never slides away while it's still in its natural spot.
const HEADER_FIXED_AT = 80;

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
 * The top navigation bar shown on every signed-in page: the back arrow and,
 * on a Room page, the Glossary Index burger, on the left; the app name (also
 * back to the Rooms list) always at the exact center; on the right, on a Room
 * page, the search (spec 21), then the language flag and the account avatar
 * (spec 09, spec 10). It is pinned to
 * the top of the page (`.app-header` in `index.css`), but slides away while
 * scrolling down and comes back as soon as the scroll turns up, so a phone
 * shows more content. While the Master previews the Room as a member (spec
 * 22b) it carries the preview's banner and stays put.
 */
export function AppHeader({ roomId, backTo, backLabel }: AppHeaderProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [glossaryOpened, setGlossaryOpened] = useState(false);
  const { pinned } = useHeadroom({ fixedAt: HEADER_FIXED_AT });
  // While previewing as a member, the bar and its banner never slide away.
  const viewAs = useViewAs();

  const handleBack = (destination: string) => {
    if (hasAppHistory()) {
      navigate(-1);
    } else {
      navigate(destination);
    }
  };

  return (
    <>
      {/* Three columns, the outer two of equal width, so the app name sits at
          the exact center whatever is on either side. */}
      <Box
        component="header"
        px={{ base: 'sm', sm: 'lg', lg: 'xl' }}
        py="sm"
        className="app-header"
        data-hidden={(!pinned && !viewAs) || undefined}
      >
        <Group gap="xs" wrap="nowrap">
          {backTo && (
            <ActionIcon
              onClick={() => handleBack(backTo)}
              variant="subtle"
              color="gray"
              size="lg"
              aria-label={backLabel}
              title={backLabel}
            >
              <ArrowLeftIcon size={20} />
            </ActionIcon>
          )}
          {roomId && (
            <Burger
              opened={glossaryOpened}
              onClick={() => setGlossaryOpened((current) => !current)}
              size="sm"
              aria-label={glossaryOpened ? t('glossary.closeToggle') : t('glossary.openToggle')}
            />
          )}
        </Group>
        <UnstyledButton component={Link} to="/" style={{ minWidth: 0 }}>
          <Title order={3} lineClamp={1} ta="center" style={{ fontFamily: 'var(--font-display)' }}>
            {t('app.name')}
          </Title>
        </UnstyledButton>
        <Group gap="xs" wrap="nowrap" justify="flex-end">
          {roomId && <SearchButton roomId={roomId} />}
          <LanguageSelector />
          <AccountButton />
        </Group>
        {viewAs && <ViewAsBanner viewAs={viewAs} />}
      </Box>
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
