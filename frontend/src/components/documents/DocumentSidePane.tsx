import { ActionIcon, Box, Group, Text, Tooltip } from '@mantine/core';
import { ArrowSquareOutIcon, XIcon } from '@phosphor-icons/react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useDocument } from '../../hooks/useDocuments';
import { useSession } from '../../hooks/useSession';
import { DocumentView } from './DocumentView';

/**
 * The Document opened beside a page (spec 37 Decision 3): a header with its
 * name, a link to its page and a close button, then the Document as its page
 * shows it, scrolling on its own while the page keeps its place.
 */
export function DocumentSidePane({
  roomId,
  documentId,
  onClose,
}: {
  roomId: string;
  /** Null while nothing is picked yet: the pane then asks for a card. */
  documentId: string | null;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  if (documentId === null) {
    return (
      <Box component="aside" aria-label={t('documents.open.pane')} style={{ position: 'sticky', top: 0 }}>
        <Group justify="space-between" wrap="nowrap" py={6} px="xs" mb="sm" style={{ borderBottom: '1px solid var(--border-default)' }}>
          <Text c="dimmed">{t('documents.open.pick')}</Text>
          <Tooltip label={t('documents.open.close')}>
            <ActionIcon variant="subtle" aria-label={t('documents.open.close')} onClick={onClose}>
              <XIcon size={18} />
            </ActionIcon>
          </Tooltip>
        </Group>
      </Box>
    );
  }
  return <PickedPane roomId={roomId} documentId={documentId} onClose={onClose} />;
}

function PickedPane({ roomId, documentId, onClose }: { roomId: string; documentId: string; onClose: () => void }) {
  const { t } = useTranslation();
  const { session } = useSession();
  // The same cached query the view below uses.
  const document = useDocument(roomId, documentId, true);

  return (
    <Box
      component="aside"
      aria-label={t('documents.open.pane')}
      style={{
        position: 'sticky',
        top: 0,
        maxHeight: '100dvh',
        overflowY: 'auto',
      }}
    >
      <Group
        justify="space-between"
        wrap="nowrap"
        py={6}
        px="xs"
        mb="sm"
        style={{
          position: 'sticky',
          top: 0,
          zIndex: 3,
          background: 'var(--bg-base)',
          borderBottom: '1px solid var(--border-default)',
        }}
      >
        <Text fw={600} truncate style={{ fontFamily: 'var(--font-display)' }}>
          {document.data?.name}
        </Text>
        <Group gap={4} wrap="nowrap">
          <Tooltip label={t('documents.open.page')}>
            <ActionIcon
              component={Link}
              to={`/rooms/${roomId}/documents/${documentId}`}
              variant="subtle"
              aria-label={t('documents.open.page')}
            >
              <ArrowSquareOutIcon size={18} />
            </ActionIcon>
          </Tooltip>
          <Tooltip label={t('documents.open.close')}>
            <ActionIcon variant="subtle" aria-label={t('documents.open.close')} onClick={onClose}>
              <XIcon size={18} />
            </ActionIcon>
          </Tooltip>
        </Group>
      </Group>
      {document.isError ? (
        // A Document that is gone or hidden from the viewer: the header keeps the close button.
        <Text c="dimmed" px="xs">
          {t('documents.detail.notFound')}
        </Text>
      ) : (
        session && (
          <DocumentView key={documentId} roomId={roomId} documentId={documentId} currentUserId={session.user.id} />
        )
      )}
    </Box>
  );
}
