import { useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { Group, Title, Button, Select, SimpleGrid, Stack, Text, Loader, Switch } from '@mantine/core';
import { PlusIcon } from '@phosphor-icons/react';
import { useSession } from '../hooks/useSession';
import { useDocuments } from '../hooks/useDocuments';
import { useTags } from '../hooks/useTags';
import { useMembers } from '../hooks/useMembers';
import { useRoom, useUpdateRoomSettings } from '../hooks/useRooms';
import { DocumentCard } from '../components/DocumentCard';
import { CreateDocumentModal } from '../components/CreateDocumentModal';
import { FullPageLoader, SignInRequired } from '../components/PageState';
import { PageLayout } from '../components/PageLayout';
import { DocumentMentionsProvider } from '../components/mentions/DocumentMentionsProvider';
import { TagFilter } from '../components/TagFilter';
import { filterDocumentsByTags } from '../lib/documentFilters';
import {
  DEFAULT_GROUP_BY,
  groupDocumentsByMainTag,
  type DocumentGroupBy,
} from '../lib/documentGrouping';
import { DEFAULT_SORT, sortDocuments, type DocumentSort } from '../lib/documentSorting';
import { canCreateDocuments, canManageTags } from '../lib/roomPermissions';
import { useTranslation } from 'react-i18next';
import type { Document } from '../types/document';
import type { Member } from '../types/member';
import type { Tag } from '../types/tag';

/**
 * `/rooms/:roomId/documents`: the Documents the viewer can see, filterable by
 * Tags through `?tag=` (FR-N2), grouped by Main Tag and sorted through
 * `?groupBy=`/`?sort=` (spec 10). The Master also gets the switch for
 * Players' Document creation (D-13).
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
  const [createOpened, setCreateOpened] = useState(false);
  const room = useRoom(roomId, true);
  const documents = useDocuments(roomId, true);
  const tags = useTags(roomId, true);
  const members = useMembers(roomId, true);
  const updateSettings = useUpdateRoomSettings(roomId);
  // `?tag=…` (repeatable): where a `#Tag` mention leads. Tags combine (AND).
  // `?groupBy=`/`?sort=` default to grouping by Main Tag, A-Z, when absent.
  const [searchParams, setSearchParams] = useSearchParams();
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

  const me = members.data?.find((m) => m.userId === currentUserId);
  const isMaster = me?.role === 'master';
  // D-13/FR-D7: same rule the backend enforces, so a Player isn't offered a
  // form that would only be rejected on submit.
  const canCreateDocument = canCreateDocuments(me, room.data);
  const shown = documents.data ? filterDocumentsByTags(documents.data, tagFilter) : undefined;
  const sorted = shown ? sortDocuments(shown, sort) : undefined;

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
        <Group justify="space-between">
          <Title order={2} style={{ fontFamily: 'var(--font-display)' }}>
            {room.data ? t('documents.titleWithRoom', { room: room.data.name }) : t('documents.title')}
          </Title>
          {canCreateDocument && (
            <Button leftSection={<PlusIcon size={16} />} onClick={() => setCreateOpened(true)}>
              {t('documents.create')}
            </Button>
          )}
        </Group>

        {isMaster && room.data && (
          <Switch
            label={t('documents.playersCanCreate')}
            checked={room.data.playersCanCreateDocuments}
            onChange={(event) => updateSettings.mutate(event.currentTarget.checked)}
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
            memberList={members.data ?? []}
            groupBy={groupBy}
          />
        )}

        <CreateDocumentModal
          opened={createOpened}
          onClose={() => setCreateOpened(false)}
          roomId={roomId}
          canManageTags={canManageTags(me)}
        />
      </DocumentMentionsProvider>
    </PageLayout>
  );
}

function DocumentsGrid({
  documents,
  roomId,
  tags,
  memberList,
  groupBy,
}: {
  documents: Document[];
  roomId: string;
  tags: Tag[];
  memberList: Member[];
  groupBy: DocumentGroupBy;
}) {
  const { t } = useTranslation();
  const cards = (list: Document[]) => (
    <SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }}>
      {list.map((document) => (
        <DocumentCard key={document.id} document={document} roomId={roomId} tags={tags} members={memberList} />
      ))}
    </SimpleGrid>
  );

  if (groupBy === 'none') {
    return cards(documents);
  }

  const groups = groupDocumentsByMainTag(documents, tags);
  return (
    <Stack gap="lg">
      {groups.map((group) => (
        <Stack key={group.tag?.id ?? 'ungrouped'} gap="xs">
          <Title order={5} c="dimmed" style={{ fontFamily: 'var(--font-display)' }}>
            {group.tag ? `#${group.tag.name}` : t('documents.ungroupedTag')}
          </Title>
          {cards(group.documents)}
        </Stack>
      ))}
    </Stack>
  );
}
