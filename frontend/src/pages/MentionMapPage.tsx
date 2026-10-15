import { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { ActionIcon, Button, Group, Stack, Text, Title, Tooltip } from '@mantine/core';
import { useMediaQuery } from '@mantine/hooks';
import { GearIcon } from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';
import { useSession } from '../hooks/useSession';
import { useDocument } from '../hooks/useDocuments';
import { useMentionMap, useSaveMentionCards } from '../hooks/useMentionMap';
import { useReadOnly } from '../hooks/useViewAs';
import { changedMentionCards } from '../lib/maps';
import { FullPageLoader, FullPageMessage, SignInRequired } from '../components/PageState';
import { PageLayout } from '../components/PageLayout';
import { DocumentMentionsProvider } from '../components/mentions/DocumentMentionsProvider';
import { MapBoard } from '../components/maps/MapBoard';
import { MentionMapModal } from '../components/maps/MentionMapModal';
import type { Board, MentionMap } from '../types/map';
import { SAVE_DELAY_MS } from './RelationshipMapPage';

/** Mantine's `sm` breakpoint: below it a map is read-only (spec 28 Decision 13). */
const WIDE_ENOUGH = '(min-width: 48em)';

type SaveState = 'idle' | 'pending' | 'saving' | 'saved' | 'error';

/**
 * `/rooms/:roomId/documents/:documentId/mention-map`: a Document's mention map
 * full page (spec 36 Decision 12). Its creator and the Master move and recolor
 * cards on a screen at least `sm` wide, saved shortly after each change, and
 * change its depth, copy or delete it from the settings.
 */
export function MentionMapPage() {
  const { t } = useTranslation();
  const { roomId, documentId } = useParams<{ roomId: string; documentId: string }>();
  const { session, loading } = useSession();

  if (!roomId || !documentId) return null;
  if (loading) return <FullPageLoader />;
  if (!session) return <SignInRequired>{t('maps.signInRequired')}</SignInRequired>;
  // The Room's Documents, for the cards' previews (spec 37 Decision 1).
  return (
    <DocumentMentionsProvider roomId={roomId} currentUserId={session.user.id}>
      <MentionMapContent roomId={roomId} documentId={documentId} />
    </DocumentMentionsProvider>
  );
}

function MentionMapContent({ roomId, documentId }: { roomId: string; documentId: string }) {
  const { t } = useTranslation();
  const document = useDocument(roomId, documentId, true);
  const map = useMentionMap(roomId, documentId);
  const back = `/rooms/${roomId}/documents/${documentId}`;

  if (document.isPending || map.isPending) return <FullPageLoader />;
  if (document.isError || map.isError || !map.data) {
    return (
      <FullPageMessage actionLabel={t('maps.mention.backToDocument')} actionTo={back}>
        {map.isError ? t('maps.mention.loadError') : t('maps.notFound')}
      </FullPageMessage>
    );
  }
  return (
    <MentionMapEditor
      key={map.data.id}
      roomId={roomId}
      documentName={document.data.name}
      map={map.data}
    />
  );
}

function MentionMapEditor({
  roomId,
  documentName,
  map,
}: {
  roomId: string;
  documentName: string;
  map: MentionMap;
}) {
  const { t } = useTranslation();
  const readOnly = useReadOnly();
  const wide = useMediaQuery(WIDE_ENOUGH, true);
  const manage = map.canManage && !readOnly;
  const editable = manage && wide;
  const saveCards = useSaveMentionCards(roomId, map.documentId);
  const [settingsOpened, setSettingsOpened] = useState(false);

  const [saveState, setSaveState] = useState<SaveState>('idle');
  // The page draws its own copy of the board. A new answer from the server (a
  // mention written elsewhere, a depth change) replaces it, unless a change of
  // the user's own is still on its way, so a save landing mid-drag doesn't
  // move anything back.
  const [drawnFrom, setDrawnFrom] = useState(map);
  const [board, setBoard] = useState<Board>(map);
  if (drawnFrom !== map) {
    setDrawnFrom(map);
    if (saveState !== 'pending' && saveState !== 'saving') setBoard(map);
  }
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  const save = (next: Board) => {
    setSaveState('saving');
    saveCards.mutate(changedMentionCards(map, next), {
      onSuccess: () => setSaveState('saved'),
      onError: () => setSaveState('error'),
    });
  };

  const handleChange = (next: Board) => {
    setBoard(next);
    setSaveState('pending');
    clearTimeout(timer.current);
    timer.current = setTimeout(() => save(next), SAVE_DELAY_MS);
  };

  const status: Record<SaveState, string | null> = {
    idle: null,
    pending: t('maps.unsaved'),
    saving: t('maps.saving'),
    saved: t('maps.saved'),
    error: saveCards.error?.message ?? t('maps.saveError'),
  };

  return (
    <PageLayout
      backTo={`/rooms/${roomId}/documents/${map.documentId}`}
      backLabel={t('maps.mention.backToDocument')}
      roomId={roomId}
    >
      <Group justify="space-between" wrap="nowrap" align="flex-start">
        <Stack gap={0} style={{ minWidth: 0 }}>
          <Title order={1} fz="h2" style={{ fontFamily: 'var(--font-display)' }}>
            {documentName}
          </Title>
          <Text size="sm" c="dimmed">
            {t('maps.mention.title')}
          </Text>
        </Stack>
        <Group gap="xs" wrap="nowrap">
          {status[saveState] && (
            <Text size="sm" c={saveState === 'error' ? 'red' : 'dimmed'} role="status">
              {status[saveState]}
            </Text>
          )}
          {saveState === 'error' && (
            <Button size="xs" variant="light" onClick={() => save(board)}>
              {t('maps.retry')}
            </Button>
          )}
          {manage && (
            <Tooltip label={t('maps.settings')} withArrow>
              <ActionIcon
                variant="subtle"
                color="gray"
                size="lg"
                aria-label={t('maps.settings')}
                onClick={() => setSettingsOpened(true)}
              >
                <GearIcon size={20} />
              </ActionIcon>
            </Tooltip>
          )}
        </Group>
      </Group>
      {manage && !wide && (
        <Text size="sm" c="dimmed">
          {t('maps.readOnlyOnPhone')}
        </Text>
      )}
      {map.documentsLeftOut > 0 && (
        <Text size="sm" c="dimmed">
          {t('maps.mention.leftOut', { number: map.documentsLeftOut })}
        </Text>
      )}
      <MapBoard
        roomId={roomId}
        board={board}
        editable={editable}
        isMaster={false}
        documents={[]}
        tags={[]}
        onChange={handleChange}
        mode="mention"
      />
      {settingsOpened && (
        <MentionMapModal
          roomId={roomId}
          documentId={map.documentId}
          documentName={documentName}
          map={map}
          onClose={() => setSettingsOpened(false)}
        />
      )}
    </PageLayout>
  );
}
