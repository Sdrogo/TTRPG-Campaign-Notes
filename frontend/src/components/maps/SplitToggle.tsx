import { ActionIcon, Tooltip } from '@mantine/core';
import { useMediaQuery } from '@mantine/hooks';
import { SquareSplitHorizontalIcon } from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';
import { SPLIT_QUERY, useSideDocument } from '../../hooks/useSideDocument';

/**
 * The map pages' button that splits the screen (spec 37): the right half
 * then shows the Document of whichever card is selected. Not on a phone.
 */
export function SplitToggle() {
  const { t } = useTranslation();
  const wide = useMediaQuery(SPLIT_QUERY, true);
  const { sideId, open, close } = useSideDocument();
  if (!wide) return null;
  const on = sideId !== null;
  const label = on ? t('documents.open.hideSplit') : t('documents.open.showSplit');
  return (
    <Tooltip label={label} withArrow>
      <ActionIcon
        variant={on ? 'light' : 'subtle'}
        color={on ? undefined : 'gray'}
        size="lg"
        aria-label={label}
        aria-pressed={on}
        onClick={() => (on ? close() : open(''))}
      >
        <SquareSplitHorizontalIcon size={20} />
      </ActionIcon>
    </Tooltip>
  );
}
