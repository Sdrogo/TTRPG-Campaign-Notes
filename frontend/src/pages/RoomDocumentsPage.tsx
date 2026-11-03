import { useState, type ReactNode } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  Affix,
  Box,
  Collapse,
  Group,
  Button,
  Select,
  Stack,
  Text,
  Switch,
  UnstyledButton,
} from '@mantine/core';
import { BooksIcon, CaretDownIcon, CaretRightIcon, PlusIcon, UsersThreeIcon } from '@phosphor-icons/react';
import { useSession } from '../hooks/useSession';
import { useDocuments } from '../hooks/useDocuments';
import { useTags } from '../hooks/useTags';
import { useMainItems, useSetMainItems } from '../hooks/useMainItems';
import { useMembers } from '../hooks/useMembers';
import { useRoom, useUpdateRoomSettings } from '../hooks/useRooms';
import { DocumentCard } from '../components/DocumentCard';
import { CreateDocumentModal } from '../components/CreateDocumentModal';
import { FullPageLoader, SignInRequired, SectionLoader } from '../components/PageState';
import { PageLayout } from '../components/PageLayout';
import { RoomPdfExports } from '../components/pdf/RoomPdfExports';
import { RoomTitleActions } from '../components/RoomTitleActions';
import { BlockHeading } from '../components/landing/BlockHeading';
import { GroupsEditor, Picker } from '../components/landing/BlockBar';
import { DragHandle, SortableItem, SortableList } from '../components/landing/Sortable';
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
import { itemLabel, reorderShownItems } from '../lib/mainItems';
import { notifyError } from '../lib/notify';
import { PageHeading } from '../components/PageHeading';
import { EmptyState } from '../components/EmptyState';

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
  // The Administrator edits the groups here too (spec 60 Decision 14b), as on
  // a Documents block; the maps row is gone (Decision 13).
  const canEditGroups = Boolean(me?.isAdmin) && !readOnly && groupBy === 'main-tag';

  const groupByOptions: { value: DocumentGroupBy; label: string }[] = [
    { value: 'main-tag', label: t('documents.groupByMainTag') },
    { value: 'none', label: t('documents.groupByNone') },
  ];
  const sortOptions: { value: DocumentSort; label: string }[] = [
    { value: 'name-asc', label: t('documents.sortNameAsc') },
    { value: 'name-desc', label: t('documents.sortNameDesc') },
  ];

  return (
    <PageLayout
      backTo={`/rooms/${roomId}`}
      backLabel={t('roomLanding.home')}
      roomId={roomId}
      showIndex
      index={{ current: 'page_documents' }}
    >
      <DocumentMentionsProvider roomId={roomId} currentUserId={currentUserId}>
        {/* Spec 57c: the Room's name is the kicker and the page is "Documents", as on
            every Room page; the Room's actions sit at the end of the row, folded in "⋮". */}
        <PageHeading
          data-tour="room"
          kicker={room.data?.name}
          title={t('documents.title')}
          titleAfter={
            (hasControls || canEditGroups) && (
              <Group gap="xs" wrap="nowrap">
              {hasControls && (
              <UnstyledButton
                onClick={() => setControlsExpanded((current) => !current)}
                aria-expanded={controlsExpanded}
                aria-label={controlsExpanded ? t('documents.hideControls') : t('documents.showControls')}
                c="dimmed"
                className="documents-controls-toggle"
              >
                {controlsExpanded ? (
                  <CaretDownIcon size={18} aria-hidden="true" />
                ) : (
                  <CaretRightIcon size={18} aria-hidden="true" />
                )}
              </UnstyledButton>
              )}
              {canEditGroups && <RoomGroupsChip roomId={roomId} tags={tags.data ?? []} mainItems={mainItems.data ?? []} />}
              </Group>
            )
          }
          actions={
            <>
              {room.data && me && !readOnly && (
                <RoomTitleActions
                  roomId={roomId}
                  roomName={room.data.name}
                  isAdmin={me.isAdmin}
                  isMaster={isMaster}
                  canImport={canCreateDocument}
                  currentUserId={currentUserId}
                  onLeft={() => navigate('/rooms')}
                  viewAsMembers={
                    isMaster ? members.data!.filter((m) => m.userId !== currentUserId) : undefined
                  }
                />
              )}
            </>
          }
        />
        {/* The user's PDFs still being made or not yet taken (spec 23b); not while previewing as a member. */}
        {!readOnly && <RoomPdfExports roomId={roomId} userId={currentUserId} />}
        {/* The primary creation action floats on every screen, within reach while
            browsing a long archive (product owner, 2026-11-02, spec 57 Decision 4). */}
        {canCreateDocument && (
          <Affix position={{ bottom: 24, right: 24 }} zIndex={150}>
            <Button
              size="md"
              radius="md"
              leftSection={<PlusIcon size={20} weight="bold" />}
              onClick={() => setCreateOpened(true)}
              className="documents-create-action"
            >
              {t('documents.create')}
            </Button>
          </Affix>
        )}
        {hasControls && (
          <Collapse expanded={controlsExpanded}>
            <Group gap="sm" align="flex-end" wrap="wrap" className="documents-controls-panel">
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
        {documents.isLoading && <SectionLoader />}
        {documents.isError && <Text c="red">{t('documents.loadError')}</Text>}
        {documents.data && documents.data.length === 0 && (
          <EmptyState icon={<BooksIcon size={28} weight="duotone" />}>{t('documents.empty')}</EmptyState>
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
            canEditGroups={canEditGroups}
          />
        )}
        {/* A Tag has no page, so where it is mentioned shows on the list
            filtered by exactly that Tag, below the results (spec 20 Decision 8). */}
        {tagFilter.length === 1 && (
          <Backlinks
            key={tagFilter[0]}
            roomId={roomId}
            target={{ kind: 'tag', id: tagFilter[0] }}
            members={members.data ?? []}
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

/**
 * "Raggruppa" on the Documents page (spec 60 Decision 14b): the Room's Main
 * items in the same groups popover as a Documents block, for the
 * Administrator who sets them (spec 11).
 */
function RoomGroupsChip({ roomId, tags, mainItems }: { roomId: string; tags: Tag[]; mainItems: MainItem[] }) {
  const { t } = useTranslation();
  const setItems = useSetMainItems(roomId);
  const [opened, setOpened] = useState(false);
  return (
    <Picker
      opened={opened}
      onClose={() => setOpened(false)}
      title={t('roomLanding.edit.groups')}
      target={
        <Button
          size="compact-sm"
          variant="light"
          leftSection={<UsersThreeIcon size={14} />}
          rightSection={<CaretDownIcon size={12} />}
          onClick={() => setOpened(true)}
        >
          {mainItems.length > 0 ? t('roomLanding.edit.groupedBy', { count: mainItems.length }) : t('roomLanding.edit.group')}
        </Button>
      }
    >
      <GroupsEditor
        groups={mainItems.map((item) => item.tagIds)}
        tags={tags}
        mainItems={[]}
        onChange={(groups) => setItems.mutate(groups.map((tagIds) => ({ tagIds })), { onError: notifyError })}
      />
    </Picker>
  );
}

function DocumentsGrid({
  documents,
  roomId,
  tags,
  mainItems,
  memberList,
  groupBy,
  canEditGroups,
}: {
  documents: Document[];
  roomId: string;
  tags: Tag[];
  mainItems: MainItem[];
  memberList: Member[];
  groupBy: DocumentGroupBy;
  /** The Administrator drags the groups by their heading (spec 60 Decision 14b). */
  canEditGroups: boolean;
}) {
  const { t } = useTranslation();
  const setItems = useSetMainItems(roomId);
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
          mentionLinks
        />
      ))}
    </Box>
  );

  if (groupBy === 'none') {
    return cards(documents);
  }

  // Each group is drawn as a Section block (spec 60 Decision 14): the same
  // heading, folding with its caret; "Senza Tag principale" last, fixed.
  const groups = groupDocumentsByMainItems(documents, tags, mainItems);
  const movable = groups.filter((group) => group.key !== UNGROUPED_KEY).map((group) => group.key);
  const block = (group: (typeof groups)[number], handle?: ReactNode) => {
    const label = group.key === UNGROUPED_KEY ? t('documents.ungroupedTag') : itemLabel(group.tags);
    const isExpanded = !collapsed.has(group.key);
    return (
      <Stack gap="sm" component="section" aria-label={label} className="room-landing-block">
        <BlockHeading
          label={label}
          count={group.documents.length}
          expanded={isExpanded}
          onToggle={() => toggleGroup(group.key)}
          leading={handle}
        />
        <Collapse expanded={isExpanded}>{cards(group.documents, 3)}</Collapse>
      </Stack>
    );
  };
  const ungrouped = groups.find((group) => group.key === UNGROUPED_KEY);
  return (
    <Stack gap="xl">
      {canEditGroups && movable.length > 1 ? (
        <SortableList
          ids={movable}
          onMove={(order) => setItems.mutate(reorderShownItems(mainItems, order), { onError: notifyError })}
        >
          {groups
            .filter((group) => group.key !== UNGROUPED_KEY)
            .map((group) => (
              <SortableItem key={group.key} id={group.key}>
                {({ ref, style }) => (
                  <div ref={ref} style={style}>
                    {block(
                      group,
                      <DragHandle label={t('roomLanding.edit.dragGroup', { name: itemLabel(group.tags) })} />,
                    )}
                  </div>
                )}
              </SortableItem>
            ))}
        </SortableList>
      ) : (
        groups
          .filter((group) => group.key !== UNGROUPED_KEY)
          .map((group) => <div key={group.key}>{block(group)}</div>)
      )}
      {ungrouped && block(ungrouped)}
    </Stack>
  );
}
