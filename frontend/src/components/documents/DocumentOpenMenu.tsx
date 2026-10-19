import { useState, type MouseEvent, type ReactNode } from 'react';
import { Menu } from '@mantine/core';
import { useMediaQuery } from '@mantine/hooks';
import { ArrowSquareOutIcon, SquareSplitHorizontalIcon } from '@phosphor-icons/react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useBackState } from '../../lib/backNav';
import { OpenMenuContext, SPLIT_QUERY, useSideDocument } from '../../hooks/useSideDocument';

/**
 * Marks an element shown from a `DocumentOpenMenu`'s children whose clicks are
 * its own; it must also stop them bubbling, or the menu's target toggles.
 */
export const OWN_CLICKS_ATTRIBUTE = 'data-own-clicks';

interface DocumentOpenMenuProps {
  roomId: string;
  documentId: string;
  /** What a click opens the menu from: a link to the Document, or a whole map card. */
  children: ReactNode;
  /** `div` around a block (a map card), `span` around inline text (a mention). */
  component?: 'span' | 'div';
  /** Told when the menu opens or closes (a map card shuts its preview meanwhile). */
  onOpenChange?: (opened: boolean) => void;
}

/**
 * A click on `children` offers to open the Document beside the page or to go
 * to its page (spec 37 Decision 2). A Ctrl, Cmd or Shift click is left to the
 * browser (a link opens in a new tab or window), and on a phone the click is
 * left alone too, so a link opens the Document directly (Decision 5).
 */
export function DocumentOpenMenu({
  roomId,
  documentId,
  children,
  component = 'span',
  onOpenChange,
}: DocumentOpenMenuProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const backState = useBackState();
  const wide = useMediaQuery(SPLIT_QUERY, true);
  const { open } = useSideDocument();
  const [opened, setOpenedState] = useState(false);
  const setOpened = (next: boolean) => {
    setOpenedState(next);
    onOpenChange?.(next);
  };

  if (!wide) {
    return children;
  }

  const handleClick = (event: MouseEvent) => {
    // A click inside something shown from `children` with clicks of its own
    // (a mention's hover preview: its carousel arrows, its links) belongs to
    // it, not to this menu. Through a portal it still bubbles here via React.
    if ((event.target as Element).closest(`[${OWN_CLICKS_ATTRIBUTE}]`)) {
      return;
    }
    // Seen before the link: it neither navigates nor reaches the menu's own toggle.
    event.stopPropagation();
    if (event.ctrlKey || event.metaKey || event.shiftKey) {
      return;
    }
    event.preventDefault();
    setOpened(!opened);
  };
  const Wrapper = component;

  return (
    <Menu opened={opened} onChange={setOpened} position="bottom-start" shadow="md" withinPortal>
      <Menu.Target>
        <Wrapper onClickCapture={handleClick} style={component === 'span' ? undefined : { cursor: 'pointer' }}>
          <OpenMenuContext value={opened}>{children}</OpenMenuContext>
        </Wrapper>
      </Menu.Target>
      <Menu.Dropdown>
        <Menu.Item leftSection={<SquareSplitHorizontalIcon size={16} />} onClick={() => open(documentId)}>
          {t('documents.open.side')}
        </Menu.Item>
        <Menu.Item
          leftSection={<ArrowSquareOutIcon size={16} />}
          onClick={() => void navigate(`/rooms/${roomId}/documents/${documentId}`, { state: backState })}
        >
          {t('documents.open.page')}
        </Menu.Item>
      </Menu.Dropdown>
    </Menu>
  );
}
