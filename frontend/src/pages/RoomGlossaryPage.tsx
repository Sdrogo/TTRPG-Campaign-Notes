import { useEffect, useMemo, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import {
  Anchor,
  Badge,
  Box,
  Button,
  Card,
  Group,
  Modal,
  Stack,
  Text,
  TextInput,
  Title,
} from '@mantine/core';
import {
  BookBookmarkIcon,
  MagnifyingGlassIcon,
  PencilSimpleIcon,
  PlusIcon,
  TrashIcon,
} from '@phosphor-icons/react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useSession } from '../hooks/useSession';
import { useDocuments } from '../hooks/useDocuments';
import {
  useCreateGlossaryEntry,
  useDeleteGlossaryEntry,
  useGlossary,
  useUpdateGlossaryEntry,
} from '../hooks/useGlossary';
import { useMembers } from '../hooks/useMembers';
import { useRoom } from '../hooks/useRooms';
import { useTags } from '../hooks/useTags';
import { useReadOnly } from '../hooks/useViewAs';
import { FullPageLoader, SectionLoader, SignInRequired } from '../components/PageState';
import { PageLayout } from '../components/PageLayout';
import { PageHeading } from '../components/PageHeading';
import { EmptyState } from '../components/EmptyState';
import { TagFilter } from '../components/TagFilter';
import { VisibilityBadge } from '../components/VisibilityBadge';
import { GlossaryEntryForm } from '../components/glossary/GlossaryEntryForm';
import { DocumentMentionsProvider } from '../components/mentions/DocumentMentionsProvider';
import { MarkdownText } from '../components/mentions/MarkdownText';
import {
  EMPTY_GLOSSARY_VALUES,
  filterGlossary,
  glossaryFormValues,
  groupByLetter,
} from '../lib/glossary';
import { canManageTags } from '../lib/roomPermissions';
import { ApiError } from '../lib/apiClient';
import type { Document } from '../types/document';
import type { GlossaryEntry, GlossaryFormValues } from '../types/glossary';
import type { Member } from '../types/member';
import type { Tag } from '../types/tag';

/**
 * `/rooms/:roomId/glossary`: the Room's dictionary (spec 79), the terms the
 * viewer sees A to Z with a letter bar, filtered by a typed word or by Tags
 * (FR-N4). The Administrator and the Master add, edit and delete entries.
 * `?entry=<id>` scrolls to one entry and lights it up, where a highlighted term
 * and a search result lead.
 */
export function RoomGlossaryPage() {
  const { t } = useTranslation();
  const { roomId } = useParams<{ roomId: string }>();
  const { session, loading } = useSession();

  if (!roomId) return null;
  if (loading) return <FullPageLoader />;
  if (!session) return <SignInRequired>{t('glossary.page.signInRequired')}</SignInRequired>;
  return (
    <DocumentMentionsProvider roomId={roomId} currentUserId={session.user.id}>
      <RoomGlossaryContent roomId={roomId} currentUserId={session.user.id} />
    </DocumentMentionsProvider>
  );
}

function RoomGlossaryContent({ roomId, currentUserId }: { roomId: string; currentUserId: string }) {
  const { t } = useTranslation();
  const room = useRoom(roomId, true);
  const glossary = useGlossary(roomId, true);
  const tags = useTags(roomId, true);
  const documents = useDocuments(roomId, true);
  const members = useMembers(roomId, true);
  const readOnly = useReadOnly();
  const [filter, setFilter] = useState('');
  const [tagIds, setTagIds] = useState<string[]>([]);
  const [editing, setEditing] = useState<GlossaryEntry | 'new' | null>(null);
  const [deleting, setDeleting] = useState<GlossaryEntry | null>(null);
  const [searchParams] = useSearchParams();
  const focused = searchParams.get('entry');
  const me = members.data?.find((member) => member.userId === currentUserId);
  const canManage = canManageTags(me) && !readOnly;

  const groups = useMemo(
    () => groupByLetter(filterGlossary(glossary.data ?? [], filter, tagIds)),
    [glossary.data, filter, tagIds],
  );

  useEffect(() => {
    if (focused && glossary.data) {
      document.getElementById(`glossary-${focused}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [focused, glossary.data]);

  return (
    <PageLayout backTo={`/rooms/${roomId}`} backLabel={t('roomLanding.home')} roomId={roomId} showIndex index={{ current: 'glossary' }}>
      <PageHeading
        kicker={room.data?.name}
        title={t('glossary.page.title')}
        actions={
          canManage && (
            <Button leftSection={<PlusIcon size={18} />} onClick={() => setEditing('new')}>
              {t('glossary.page.new')}
            </Button>
          )
        }
      />
      {glossary.isPending && <SectionLoader />}
      {glossary.isError && <Text c="red">{t('glossary.page.loadError')}</Text>}
      {glossary.data?.length === 0 && (
        <EmptyState icon={<BookBookmarkIcon size={28} weight="duotone" />}>
          {t(canManage ? 'glossary.page.emptyManager' : 'glossary.page.empty')}
        </EmptyState>
      )}
      {glossary.data && glossary.data.length > 0 && (
        <Stack gap="md">
          <Group align="flex-start" gap="sm" wrap="wrap">
            <TextInput
              aria-label={t('glossary.page.filter')}
              placeholder={t('glossary.page.filter')}
              leftSection={<MagnifyingGlassIcon size={18} />}
              value={filter}
              onChange={(event) => setFilter(event.currentTarget.value)}
              style={{ flex: '1 1 14rem' }}
            />
            <TagFilter
              tags={tags.data ?? []}
              value={tagIds}
              onChange={setTagIds}
              style={{ flex: '1 1 14rem' }}
            />
          </Group>
          {groups.length > 0 && (
            <Group gap={6} component="nav" aria-label={t('glossary.page.letters')}>
              {groups.map(({ letter }) => (
                <Anchor key={letter} href={`#glossary-letter-${letter}`} fw={600} size="sm">
                  {letter}
                </Anchor>
              ))}
            </Group>
          )}
          {groups.length === 0 && <Text c="dimmed">{t('common.noResults')}</Text>}
          {groups.map(({ letter, entries }) => (
            <Stack key={letter} gap="sm">
              <Title order={3} id={`glossary-letter-${letter}`} ff="var(--font-display)">
                {letter}
              </Title>
              {entries.map((entry) => (
                <EntryCard
                  key={entry.id}
                  roomId={roomId}
                  entry={entry}
                  tags={tags.data ?? []}
                  focused={entry.id === focused}
                  canManage={canManage}
                  onEdit={() => setEditing(entry)}
                  onDelete={() => setDeleting(entry)}
                />
              ))}
            </Stack>
          ))}
        </Stack>
      )}
      <EditModal
        roomId={roomId}
        editing={editing}
        onClose={() => setEditing(null)}
        defaultVisibility={room.data?.defaultVisibility}
        tags={tags.data ?? []}
        documents={documents.data ?? []}
        members={members.data ?? []}
      />
      <DeleteModal roomId={roomId} entry={deleting} onClose={() => setDeleting(null)} />
    </PageLayout>
  );
}

interface EntryCardProps {
  roomId: string;
  entry: GlossaryEntry;
  tags: Tag[];
  focused: boolean;
  canManage: boolean;
  onEdit: () => void;
  onDelete: () => void;
}

function EntryCard({ roomId, entry, tags, focused, canManage, onEdit, onDelete }: EntryCardProps) {
  const { t } = useTranslation();
  const entryTags = tags.filter((tag) => entry.tagIds.includes(tag.id));
  return (
    <Card
      id={`glossary-${entry.id}`}
      withBorder
      radius="md"
      p="md"
      data-testid="glossary-entry"
      style={focused ? { borderColor: 'var(--accent-glossary)' } : undefined}
    >
      <Stack gap="xs">
        <Group justify="space-between" align="flex-start" wrap="nowrap">
          <Box style={{ minWidth: 0 }}>
            <Title order={4} ff="var(--font-display)" c="var(--accent-glossary)">
              {entry.term}
            </Title>
            {entry.aliases.length > 0 && (
              <Text size="xs" c="dimmed">
                {entry.aliases.join(', ')}
              </Text>
            )}
          </Box>
          <Group gap={6} wrap="nowrap">
            {entry.visibility !== 'room' && <VisibilityBadge visibility={entry.visibility} />}
            {canManage && entry.canEdit && (
              <Button
                variant="subtle"
                color="gray"
                size="compact-sm"
                aria-label={t('glossary.page.edit', { term: entry.term })}
                onClick={onEdit}
              >
                <PencilSimpleIcon size={16} />
              </Button>
            )}
            {canManage && entry.canDelete && (
              <Button
                variant="subtle"
                color="red"
                size="compact-sm"
                aria-label={t('glossary.page.delete', { term: entry.term })}
                onClick={onDelete}
              >
                <TrashIcon size={16} />
              </Button>
            )}
          </Group>
        </Group>
        {entry.definition.trim() !== '' && <MarkdownText text={entry.definition} fz="sm" />}
        {(entryTags.length > 0 || entry.documents.length > 0) && (
          <Group gap="xs">
            {entryTags.map((tag) => (
              <Badge key={tag.id} variant="light" color="gray" size="sm" tt="none">
                #{tag.name}
              </Badge>
            ))}
            {entry.documents.map((document) => (
              <Anchor key={document.id} component={Link} to={`/rooms/${roomId}/documents/${document.id}`} size="sm">
                {document.name}
              </Anchor>
            ))}
          </Group>
        )}
      </Stack>
    </Card>
  );
}

function errorText(error: unknown, fallback: string): string {
  return error instanceof ApiError ? error.message : fallback;
}

interface EditModalProps {
  roomId: string;
  editing: GlossaryEntry | 'new' | null;
  onClose: () => void;
  defaultVisibility?: GlossaryFormValues['visibility'];
  tags: Tag[];
  documents: Document[];
  members: Member[];
}

function EditModal({ roomId, editing, onClose, defaultVisibility, tags, documents, members }: EditModalProps) {
  const { t } = useTranslation();
  const create = useCreateGlossaryEntry(roomId);
  const update = useUpdateGlossaryEntry(roomId);
  const mutation = editing === 'new' ? create : update;
  const close = () => {
    create.reset();
    update.reset();
    onClose();
  };
  const initial: GlossaryFormValues | null =
    editing === 'new'
      ? { ...EMPTY_GLOSSARY_VALUES, visibility: defaultVisibility ?? 'room' }
      : editing
        ? glossaryFormValues(editing)
        : null;
  return (
    <Modal
      opened={editing !== null}
      onClose={close}
      title={editing === 'new' ? t('glossary.form.createTitle') : t('glossary.form.editTitle')}
      size="lg"
    >
      {initial && (
        <GlossaryEntryForm
          key={editing === 'new' ? 'new' : (editing as GlossaryEntry).id}
          initialValues={initial}
          members={members}
          tags={tags}
          documents={documents}
          submitLabel={editing === 'new' ? t('glossary.form.create') : t('common.save')}
          submitting={mutation.isPending}
          error={mutation.isError ? errorText(mutation.error, t('glossary.form.saveError')) : null}
          onCancel={close}
          onSubmit={(values) => {
            if (editing === 'new') {
              create.mutate(values, { onSuccess: close });
            } else if (editing) {
              update.mutate({ entryId: editing.id, values }, { onSuccess: close });
            }
          }}
        />
      )}
    </Modal>
  );
}

function DeleteModal({ roomId, entry, onClose }: { roomId: string; entry: GlossaryEntry | null; onClose: () => void }) {
  const { t } = useTranslation();
  const remove = useDeleteGlossaryEntry(roomId);
  return (
    <Modal opened={entry !== null} onClose={onClose} title={t('glossary.delete.title')}>
      <Stack>
        <Text size="sm">{t('glossary.delete.body', { term: entry?.term ?? '' })}</Text>
        {remove.isError && (
          <Text c="red" size="sm" role="alert">
            {errorText(remove.error, t('glossary.delete.error'))}
          </Text>
        )}
        <Group>
          <Button
            color="red"
            loading={remove.isPending}
            onClick={() => entry && remove.mutate(entry.id, { onSuccess: onClose })}
          >
            {t('common.delete')}
          </Button>
          <Button variant="subtle" color="gray" onClick={onClose}>
            {t('common.cancel')}
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
