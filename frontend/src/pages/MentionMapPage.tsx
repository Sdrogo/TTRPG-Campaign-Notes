import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { ActionIcon, Box, Button, Group, Stack, Text, Title, Tooltip } from '@mantine/core';
import { useMediaQuery } from '@mantine/hooks';
import { GearIcon } from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';
import { useSession } from '../hooks/useSession';
import { useDocument } from '../hooks/useDocuments';
import { mentionMapQueryKey, useMentionMap, useSaveMentionCards } from '../hooks/useMentionMap';
import { useMapEvents } from '../hooks/useMapEvents';
import { useBoardAutosave, type SaveState } from '../hooks/useBoardAutosave';
import { useReadOnly } from '../hooks/useViewAs';
import { toMentionBody } from '../lib/maps';
import { FullPageLoader, FullPageMessage, SignInRequired } from '../components/PageState';
import { PageLayout } from '../components/PageLayout';
import { MapBoard } from '../components/maps/MapBoard';
import { SplitToggle } from '../components/maps/SplitToggle';
import { useSideDocument } from '../hooks/useSideDocument';
import { MentionMapModal } from '../components/maps/MentionMapModal';
import type { Board, MentionMap } from '../types/map';

/** Mantine's `sm` breakpoint: below it a map is read-only (spec 28 Decision 13). */
const WIDE_ENOUGH = '(min-width: 48em)';

/**
 * `/rooms/:roomId/documents/:documentId/mention-map`: a Document's mention map
 * full page (spec 36 Decision 12). Its creator and the Master move and recolor
 * cards on a screen at least `sm` wide, saved shortly after each change the
 * way a free map is (spec 43: only what changed, laid over whatever arrives
 * meanwhile), and change its depth, copy or delete it from the settings. It
 * follows the Room stream like a free map (spec 52).
 */
export function MentionMapPage() {
  const { t } = useTranslation();
  const { roomId, documentId } = useParams<{ roomId: string; documentId: string }>();
  const { session, loading } = useSession();

  if (!roomId || !documentId) return null;
  if (loading) return <FullPageLoader />;
  if (!session) return <SignInRequired>{t('maps.signInRequired')}</SignInRequired>;
  return <MentionMapContent roomId={roomId} documentId={documentId} />;
}

function MentionMapContent({ roomId, documentId }: { roomId: string; documentId: string }) {
  const { t } = useTranslation();
  const document = useDocument(roomId, documentId, true);
  const live = useMapEvents(roomId, undefined, mentionMapQueryKey(roomId, documentId));
  const map = useMentionMap(roomId, documentId, live.fallback);
  const back = `/rooms/${roomId}/documents/${documentId}`;

  if (document.isPending || map.isPending) return <FullPageLoader />;
  if (live.gone || document.isError || map.isError || !map.data) {
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
  const split = useSideDocument();
  // While the split is open, a click on a card shows its Document there (spec 37).
  const splitOpen = split.sideId !== null && wide;
  const manage = map.canManage && !readOnly;
  const editable = manage && wide;
  const [settingsOpened, setSettingsOpened] = useState(false);
  const autosave = useBoardAutosave<Board, MentionMap>(
    { groups: map.groups, cards: map.cards, arrows: map.arrows },
    map.revision,
    useSaveMentionCards(roomId, map.documentId),
    toMentionBody,
    (saved) => ({ groups: saved.groups, cards: saved.cards, arrows: saved.arrows }),
  );
  const { saveState } = autosave;

  const status: Record<SaveState, string | null> = {
    idle: null,
    pending: t('maps.unsaved'),
    saving: t('maps.saving'),
    saved: t('maps.saved'),
    error: autosave.error?.message ?? t('maps.saveError'),
  };

  return (
    <PageLayout allowEmptySide
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
            <Button size="xs" variant="light" onClick={autosave.retry}>
              {t('maps.retry')}
            </Button>
          )}
          <SplitToggle />
          {manage && (
            <Tooltip label={t('maps.settings')} withArrow>
              <ActionIcon
                variant="subtle"
                color="gray"
                size="lg"
                aria-label={t('maps.settings')}
                onClick={() => setSettingsOpened(true)}
              >
                <GearIcon size={24} />
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
      <Box data-split-anchor>
        <MapBoard
          roomId={roomId}
          board={autosave.value}
          editable={editable}
          isMaster={false}
          documents={[]}
          tags={[]}
          onChange={autosave.change}
          // On a phone a Document opens under the map.
          onSelectDocument={splitOpen || !wide ? split.open : undefined}
          mode="mention"
        />
      </Box>
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
