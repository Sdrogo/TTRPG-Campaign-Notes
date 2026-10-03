import { Badge, type MantineSize } from '@mantine/core';
import { EyeIcon } from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';

/**
 * The "Revealed" mark (spec 22 Decision 3) on content the Master just showed
 * the viewer: a Document's card until they open it, and the Document, Note or
 * Comment on the page they opened it with.
 */
export function RevealedBadge({ size = 'sm' }: { size?: MantineSize }) {
  const { t } = useTranslation();
  return (
    <Badge
      size={size}
      variant="light"
      color="accent"
      leftSection={<EyeIcon size={12} aria-hidden="true" />}
      title={t('reveal.revealedLabel')}
      style={{ flexShrink: 0 }}
    >
      {t('reveal.revealed')}
    </Badge>
  );
}
