import { useState } from 'react';
import { ActionIcon, Button, Kbd } from '@mantine/core';
import { useHotkeys } from '@mantine/hooks';
import { MagnifyingGlassIcon } from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';
import { searchShortcutLabel } from '../../lib/search';
import { SearchSpotlight } from './SearchSpotlight';

interface SearchButtonProps {
  roomId: string;
}

/**
 * Opens the Room's search (spec 21 Decision 2) from the top bar: a search
 * field with its shortcut on wide screens, a magnifier on narrow ones.
 * `Ctrl+K` (`⌘K` on macOS) opens it from anywhere on the page, `/` from
 * anywhere but a text field, where it is just a character.
 */
export function SearchButton({ roomId }: SearchButtonProps) {
  const { t } = useTranslation();
  const [opened, setOpened] = useState(false);
  const open = () => setOpened(true);
  useHotkeys([['mod+K', open]], []);
  useHotkeys([['/', open]]);

  return (
    <>
      <Button
        visibleFrom="md"
        variant="default"
        size="sm"
        onClick={open}
        leftSection={<MagnifyingGlassIcon size={16} />}
        rightSection={<Kbd size="xs">{searchShortcutLabel()}</Kbd>}
        aria-keyshortcuts="Control+K Meta+K /"
      >
        {t('search.open')}
      </Button>
      <ActionIcon
        hiddenFrom="md"
        variant="subtle"
        color="gray"
        size="lg"
        onClick={open}
        aria-label={t('search.open')}
        title={t('search.open')}
      >
        <MagnifyingGlassIcon size={20} />
      </ActionIcon>
      <SearchSpotlight roomId={roomId} opened={opened} onClose={() => setOpened(false)} />
    </>
  );
}
