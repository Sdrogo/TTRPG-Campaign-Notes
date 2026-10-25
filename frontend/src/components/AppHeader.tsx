import { Link } from 'react-router-dom';
import { Box, Group, Title, UnstyledButton } from '@mantine/core';
import { useHeadroom } from '@mantine/hooks';
import { ArrowLeftIcon } from '@phosphor-icons/react';
import { ViewAsBanner } from './ViewAsBanner';
import { useViewAs } from '../hooks/useViewAs';
import { AccountButton } from './account/AccountButton';
import { LanguageSelector } from './LanguageSelector';
import { QuickNavMenu } from './QuickNavMenu';
import { SearchButton } from './search/SearchButton';
import { useTranslation } from 'react-i18next';
import { LabeledActionIcon } from './LabeledActionIcon';
import { useHierarchicalBack } from '../hooks/useHierarchicalBack';

interface AppHeaderProps {
  /** Given on a Room-scoped page, this shows the Room's search (spec 21).
   *  Omitted elsewhere (the Rooms list, the Account page), where there is no
   *  Room to search. The Room's Index is a tab on the page's left edge
   *  (`RoomIndex`, rendered by `PageLayout`, spec 44), not in this bar. */
  roomId?: string;
  /** Given on any nested page, this shows a "back" arrow (icon only, named
   *  by `backLabel` for screen readers), to the page it was
   *  opened from or else to `backTo`, its parent. Omitted on the
   *  Rooms list and the landing page, which have nowhere to go back to. */
  backTo?: string;
  backLabel?: string;
}

// How far down the page the bar stays put whatever the scroll direction: about
// its own height, so it never slides away while it's still in its natural spot.
const HEADER_FIXED_AT = 80;

/**
 * The top navigation bar shown on every signed-in page: the quick navigation
 * burger (spec 45) and the back arrow on the left; the app name (also a link
 * to the landing page) always at the exact center; on the right, on a Room
 * page, the search (spec 21), then the language flag and the account avatar
 * (spec 09, spec 10). It is pinned to
 * the top of the page (`.app-header` in `index.css`), but slides away while
 * scrolling down and comes back as soon as the scroll turns up, so a phone
 * shows more content. While the Master previews the Room as a member (spec
 * 22b) it carries the preview's banner and stays put.
 */
export function AppHeader({ roomId, backTo, backLabel }: AppHeaderProps) {
  const { t } = useTranslation();
  const { pinned } = useHeadroom({ fixedAt: HEADER_FIXED_AT });
  // While previewing as a member, the bar and its banner never slide away.
  const viewAs = useViewAs();

  // Hierarchical, never the browser history: the page this one was opened
  // from (a map from a Document...), skipping Documents and maps deleted
  // since, else its fixed parent.
  const { destination, goBack } = useHierarchicalBack(backTo ?? '/');
  const label = backTo && destination !== backTo ? t('common.back') : backLabel;
  const handleBack = () => {
    void goBack();
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
          <QuickNavMenu />
          {backTo && (
            <LabeledActionIcon
              onClick={handleBack}
              variant="subtle"
              color="gray"
              size="lg"
              aria-label={label}
            >
              <ArrowLeftIcon size={20} />
            </LabeledActionIcon>
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
    </>
  );
}
