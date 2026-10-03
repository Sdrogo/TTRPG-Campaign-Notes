import { useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  ActionIcon,
  Affix,
  Box,
  Collapse,
  Group,
  Title,
  Button,
  Select,
  Stack,
  Text,
  Loader,
  Switch,
  UnstyledButton,
} from '@mantine/core';
import { CaretDownIcon, CaretRightIcon, PlusIcon } from '@phosphor-icons/react';
import { useSession } from '../hooks/useSession';
import { useDocuments } from '../hooks/useDocuments';
import { useTags } from '../hooks/useTags';
import { useMainItems } from '../hooks/useMainItems';
import { useMembers } from '../hooks/useMembers';
import { useRoom, useUpdateRoomSettings } from '../hooks/useRooms';
import { DocumentCard } from '../components/DocumentCard';
import { CreateDocumentModal } from '../components/CreateDocumentModal';
import { FullPageLoader, SignInRequired } from '../components/PageState';
import { PageLayout } from '../components/PageLayout';
import { RoomTitleActions } from '../components/RoomTitleActions';
import { DocumentMentionsProvider } from '../components/mentions/DocumentMentionsProvider';
import { TagFilter } from '../components/TagFilter';
import { Backlinks } from '../components/mentions/Backlinks';
import { filterDocumentsByTags } from '../lib/documentFilters';
import { hasUnseenReveal } from '../lib/reveal';
import { useMyReveals } from '../hooks/useReveals';
import { useReadOnly } from '../hooks/useViewAs';
import {
  DEFAULT_GROUP_BY,
  groupDocumentsByMainItems,
  UNGROUPED_KEY,
  type DocumentGroupBy,
} from '../lib/documentGrouping';
import { DEFAULT_SORT, sortDocuments, type DocumentSort } from '../lib/documentSorting';
import { canCreateDocuments, canManageTags } from '../lib/roomPermissions';
import { useTranslation } from 'react-i18next';
import type { Document } from '../types/document';
import type { Member } from '../types/member';
import type { MainItem, Tag } from '../types/tag';
import { itemLabel } from '../lib/mainItems';

/**
 * `/rooms/:roomId/documents`: the Documents the viewer can see, filterable by
 * Tags through `?tag=` (FR-N2), grouped by Main Tag and sorted through
 * `?groupBy=`/`?sort=` (spec 10). The Master also gets the switch for
 * Players' Document creation (D-13). The filter/sort/settings row next to
 * the title collapses independently of it, so the title stays visible.
 */
export function RoomDocumentsPage() {
  const { t } = useTranslation();
  const { roomId } = useParams<{ roomId: string }>();
  const { session, loading: sessionLoading } = useSession();

  if (!roomId) {
    return null;
  }

  if (sessionLoading) {
    return <FullPageLoader />;
  }

  if (!session) {
    return <SignInRequired>{t('documents.signInRequired')}</SignInRequired>;
  }

  return <RoomDocumentsContent roomId={roomId} currentUserId={session.user.id} />;
}

function RoomDocumentsContent({ roomId, currentUserId }: { roomId: string; currentUserId: string }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [createOpened, setCreateOpened] = useState(false);
  const room = useRoom(roomId, true);
  const documents = useDocuments(roomId, true);
  const tags = useTags(roomId, true);
  const mainItems = useMainItems(roomId, true);
  const members = useMembers(roomId, true);
  const updateSettings = useUpdateRoomSettings(roomId);
  // `?tag=…` (repeatable): where a `#Tag` mention leads. Tags combine (AND).
  // `?groupBy=`/`?sort=` default to grouping by Main Tag, A-Z, when absent.
  const [searchParams, setSearchParams] = useSearchParams();
  // The filters/settings row below the title starts collapsed (Andrea,
  // 2026-10-03), unless the page opens already filtered by Tag - then the
  // filter that's narrowing the list is shown. The title always stays.
  const [controlsExpanded, setControlsExpanded] = useState(() => searchParams.has('tag'));
  const tagFilter = searchParams.getAll('tag');
  const groupBy = (searchParams.get('groupBy') as DocumentGroupBy | null) ?? DEFAULT_GROUP_BY;
  const sort = (searchParams.get('sort') as DocumentSort | null) ?? DEFAULT_SORT;

  const setTagFilter = (tagIds: string[]) => {
    const next = new URLSearchParams(searchParams);
    next.delete('tag');
    for (const id of tagIds) next.append('tag', id);
    setSearchParams(next, { replace: true });
  };
  const setParam = (key: string, value: string, defaultValue: string) => {
    const next = new URLSearchParams(searchParams);
    if (value === defaultValue) next.delete(key);
    else next.set(key, value);
    setSearchParams(next, { replace: true });
  };

  // A Master previewing the Room as a member (spec 22b) gets no write control.
  const readOnly = useReadOnly();
  const me = members.data?.find((m) => m.userId === currentUserId);
  const isMaster = me?.role === 'master' && !readOnly;
  // D-13/FR-D7: same rule the backend enforces, so a Player isn't offered a
  // form that would only be rejected on submit.
  const canCreateDocument = canCreateDocuments(me, room.data) && !readOnly;
  const shown = documents.data ? filterDocumentsByTags(documents.data, tagFilter) : undefined;
  const sorted = shown ? sortDocuments(shown, sort) : undefined;
  const hasControls = Boolean((isMaster && room.data) || (documents.data && documents.data.length > 0));

  const groupByOptions: { value: DocumentGroupBy; label: string }[] = [
    { value: 'main-tag', label: t('documents.groupByMainTag') },
    { value: 'none', label: t('documents.groupByNone') },
  ];
  const sortOptions: { value: DocumentSort; label: string }[] = [
    { value: 'name-asc', label: t('documents.sortNameAsc') },
    { value: 'name-desc', label: t('documents.sortNameDesc') },
  ];

  return (
    <PageLayout backTo="/" backLabel={t('common.myRooms')} roomId={roomId}>
      <DocumentMentionsProvider roomId={roomId} currentUserId={currentUserId}>
        {/* The Room's actions sit at the end of the title row, folded in "⋮". */}
        <Group justify="space-between" wrap="nowrap">
          <Group gap="sm" align="center" wrap="wrap" style={{ minWidth: 0 }}>
            <Title order={1} fz="h2" style={{ fontFamily: 'var(--font-display)' }}>
              {room.data ? room.data.name : t('documents.title')}
            </Title>
            {hasControls && (
              <UnstyledButton
                onClick={() => setControlsExpanded((current) => !current)}
                aria-expanded={controlsExpanded}
                aria-label={controlsExpanded ? t('documents.hideControls') : t('documents.showControls')}
                c="dimmed"
                style={{ display: 'inline-flex', alignItems: 'center' }}
              >
                {controlsExpanded ? (
                  <CaretDownIcon size={16} aria-hidden="true" />
                ) : (
                  <CaretRightIcon size={16} aria-hidden="true" />
                )}
              </UnstyledButton>
            )}
          </Group>
          {room.data && me && !readOnly && (
            <RoomTitleActions
              roomId={roomId}
              roomName={room.data.name}
              isAdmin={me.isAdmin}
              isMaster={isMaster}
              currentUserId={currentUserId}
              onLeft={() => navigate('/')}
              viewAsMembers={
                isMaster ? members.data!.filter((m) => m.userId !== currentUserId) : undefined
              }
            />
          )}
        </Group>
        {/* A round floating "+" at the bottom right, always within reach. */}
        {canCreateDocument && (
          <Affix position={{ bottom: 24, right: 24 }} zIndex={150}>
            <ActionIcon
              size={56}
              radius="xl"
              variant="filled"
              onClick={() => setCreateOpened(true)}
              aria-label={t('documents.create')}
              title={t('documents.create')}
              style={{ boxShadow: 'var(--mantine-shadow-lg)' }}
            >
              <PlusIcon size={28} weight="bold" />
            </ActionIcon>
          </Affix>
        )}
        {hasControls && (
          <Collapse expanded={controlsExpanded}>
            <Group gap="sm" align="flex-end" wrap="wrap">
              {isMaster && room.data && (
                <Switch
                  label={t('documents.playersCanCreate')}
                  checked={room.data.playersCanCreateDocuments}
                  onChange={(event) =>
                    updateSettings.mutate({ playersCanCreateDocuments: event.currentTarget.checked })
                  }
                />
              )}
              {documents.data && documents.data.length > 0 && (
                <Group gap="sm" align="flex-end" wrap="wrap">
                  <TagFilter
                    tags={tags.data ?? []}
                    value={tagFilter}
                    onChange={setTagFilter}
                    maw={{ base: '100%', sm: 320 }}
                  />
                  <Select
                    aria-label={t('documents.groupByLabel')}
                    data={groupByOptions}
                    value={groupBy}
                    onChange={(value) => value && setParam('groupBy', value, DEFAULT_GROUP_BY)}
                    allowDeselect={false}
                    w={{ base: '100%', sm: 220 }}
                  />
                  <Select
                    aria-label={t('documents.sortLabel')}
                    data={sortOptions}
                    value={sort}
                    onChange={(value) => value && setParam('sort', value, DEFAULT_SORT)}
                    allowDeselect={false}
                    w={{ base: '100%', sm: 180 }}
                  />
                </Group>
              )}
            </Group>
          </Collapse>
        )}
        {/* Spec 20 Decision 8: a Tag has no page, so where it is mentioned
            shows on the list filtered by exactly that Tag. */}
        {tagFilter.length === 1 && (
          <Backlinks
            key={tagFilter[0]}
            roomId={roomId}
            target={{ kind: 'tag', id: tagFilter[0] }}
            members={members.data ?? []}
          />
        )}
        {documents.isLoading && <Loader color="accent" />}
        {documents.isError && <Text c="red">{t('documents.loadError')}</Text>}
        {documents.data && documents.data.length === 0 && (
          <Text c="dimmed">{t('documents.empty')}</Text>
        )}
        {documents.data && documents.data.length > 0 && sorted && sorted.length === 0 && (
          <Group gap="xs">
            <Text c="dimmed">{t('documents.noMatchForTags', { count: tagFilter.length })}</Text>
            <Button size="xs" variant="subtle" onClick={() => setTagFilter([])}>
              {t('documents.showAll')}
            </Button>
          </Group>
        )}
        {sorted && sorted.length > 0 && (
          <DocumentsGrid
            documents={sorted}
            roomId={roomId}
            tags={tags.data ?? []}
            mainItems={mainItems.data ?? []}
            memberList={members.data ?? []}
            groupBy={groupBy}
          />
        )}
        {/* Room under the last cards, so the floating "+" never covers them. */}
        {canCreateDocument && <Box h={64} aria-hidden="true" />}

        <CreateDocumentModal
          opened={createOpened}
          onClose={() => setCreateOpened(false)}
          roomId={roomId}
          canManageTags={canManageTags(me)}
          defaultVisibility={room.data?.defaultVisibility}
        />
      </DocumentMentionsProvider>
    </PageLayout>
  );
}

function DocumentsGrid({
  documents,
  roomId,
  tags,
  mainItems,
  memberList,
  groupBy,
}: {
  documents: Document[];
  roomId: string;
  tags: Tag[];
  mainItems: MainItem[];
  memberList: Member[];
  groupBy: DocumentGroupBy;
}) {
  const { t } = useTranslation();
  // Content revealed to the viewer they haven't opened yet marks its card
  // (spec 22). Not while previewing as a member: those are the Master's own.
  const reveals = useMyReveals(!useReadOnly());
  // Which group keys are collapsed; everything starts expanded. Not
  // persisted - a reload or a `groupBy`/sort change is a fresh page.
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const toggleGroup = (key: string) =>
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  // `.documents-grid` (index.css): 1 to 3 columns like before, then more on
  // very wide screens, so a card never grows huge.
  // Grouped, the cards sit under a group heading, one level deeper.
  const cards = (list: Document[], headingOrder: 2 | 3 = 2) => (
    <Box className="documents-grid">
      {list.map((document) => (
        <DocumentCard
          key={document.id}
          document={document}
          roomId={roomId}
          tags={tags}
          members={memberList}
          headingOrder={headingOrder}
          revealed={hasUnseenReveal(reveals.data, document.id)}
        />
      ))}
    </Box>
  );

  if (groupBy === 'none') {
    return cards(documents);
  }

  const groups = groupDocumentsByMainItems(documents, tags, mainItems);
  return (
    <Stack gap="lg">
      {groups.map((group) => {
        const key = group.key;
        const isExpanded = !collapsed.has(key);
        const label =
          group.key === UNGROUPED_KEY ? t('documents.ungroupedTag') : itemLabel(group.tags);
        return (
          <Stack key={key} gap="xs">
            <Title order={2} fz="h5" style={{ fontFamily: 'var(--font-display)' }}>
              <UnstyledButton
                onClick={() => toggleGroup(key)}
                aria-expanded={isExpanded}
                c="dimmed"
                style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
              >
                {isExpanded ? (
                  <CaretDownIcon size={16} aria-hidden="true" />
                ) : (
                  <CaretRightIcon size={16} aria-hidden="true" />
                )}
                {label}
              </UnstyledButton>
            </Title>
            <Collapse expanded={isExpanded}>{cards(group.documents, 3)}</Collapse>
          </Stack>
        );
      })}
    </Stack>
  );
}
