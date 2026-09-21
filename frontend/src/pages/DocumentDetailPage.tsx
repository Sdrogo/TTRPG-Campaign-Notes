import { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import {
  Stack,
  Group,
  Title,
  Text,
  Button,
  Loader,
  Card,
  Divider,
  TextInput,
  Textarea,
  Select,
  MultiSelect,
  Badge,
  ActionIcon,
} from '@mantine/core';
import { ArrowLeftIcon, PencilSimpleIcon, TrashIcon, XIcon } from '@phosphor-icons/react';
import { notifications } from '@mantine/notifications';
import { useSession } from '../hooks/useSession';
import {
  useDocument,
  useUpdateDocument,
  useAddDocumentOwner,
  useRemoveDocumentOwner,
  useUploadDocumentImages,
  useImportDocumentImage,
  useDeleteDocumentImage,
} from '../hooks/useDocuments';
import { useTags } from '../hooks/useTags';
import { useMembers } from '../hooks/useMembers';
import { VisibilityBadge } from '../components/VisibilityBadge';
import { DocumentImageGallery } from '../components/DocumentImageGallery';
import { AddDocumentImages } from '../components/AddDocumentImages';
import type { Document, DocumentVisibility } from '../types/document';
import type { Member } from '../types/member';
import type { Tag } from '../types/tag';

const VISIBILITY_OPTIONS = [
  { value: 'room', label: 'Stanza (tutti i membri)' },
  { value: 'master', label: 'Solo Master' },
  { value: 'private', label: 'Privato (Owner + Master)' },
  { value: 'selective', label: 'Selettivo' },
];

export function DocumentDetailPage() {
  const { roomId, documentId } = useParams<{ roomId: string; documentId: string }>();
  const { session, loading: sessionLoading } = useSession();

  if (!roomId || !documentId) {
    return null;
  }

  if (sessionLoading) {
    return (
      <Stack align="center" justify="center" style={{ minHeight: '100svh' }}>
        <Loader color="accent" />
      </Stack>
    );
  }

  if (!session) {
    return (
      <Stack align="center" justify="center" gap="md" style={{ minHeight: '100svh' }}>
        <Text>Accedi per vedere questo Documento.</Text>
        <Button component={Link} to="/">
          Vai al login
        </Button>
      </Stack>
    );
  }

  return (
    <DocumentDetailLoader roomId={roomId} documentId={documentId} currentUserId={session.user.id} />
  );
}

function DocumentDetailLoader({
  roomId,
  documentId,
  currentUserId,
}: {
  roomId: string;
  documentId: string;
  currentUserId: string;
}) {
  const document = useDocument(roomId, documentId, true);
  const tags = useTags(roomId, true);
  const members = useMembers(roomId, true);

  if (document.isLoading) {
    return (
      <Stack align="center" justify="center" style={{ minHeight: '100svh' }}>
        <Loader color="accent" />
      </Stack>
    );
  }

  if (document.isError || !document.data) {
    return (
      <Stack align="center" justify="center" gap="md" style={{ minHeight: '100svh' }}>
        <Text>Documento non trovato o non visibile.</Text>
        <Button component={Link} to={`/rooms/${roomId}/documents`}>
          Torna ai Documenti
        </Button>
      </Stack>
    );
  }

  return (
    <DocumentPanel
      key={document.data.id}
      roomId={roomId}
      document={document.data}
      tags={tags.data ?? []}
      members={members.data ?? []}
      currentUserId={currentUserId}
    />
  );
}

function DocumentPanel({
  roomId,
  document,
  tags,
  members,
  currentUserId,
}: {
  roomId: string;
  document: Document;
  tags: Tag[];
  members: Member[];
  currentUserId: string;
}) {
  const [editing, setEditing] = useState(false);
  const updateDocument = useUpdateDocument(roomId, document.id);
  const addOwner = useAddDocumentOwner(roomId, document.id);
  const removeOwner = useRemoveDocumentOwner(roomId, document.id);
  const uploadImages = useUploadDocumentImages(roomId, document.id);
  const importImage = useImportDocumentImage(roomId, document.id);
  const deleteImage = useDeleteDocumentImage(roomId, document.id);

  const [name, setName] = useState(document.name);
  const [description, setDescription] = useState(document.description);
  const [visibility, setVisibility] = useState<DocumentVisibility>(document.visibility);
  const [tagIds, setTagIds] = useState<string[]>(document.tagIds);
  const [addOwnerId, setAddOwnerId] = useState<string | null>(null);

  const notifyError = (error: unknown) => {
    notifications.show({
      color: 'red',
      message: error instanceof Error ? error.message : String(error),
    });
  };

  const isOwner =
    document.ownerIds.includes(currentUserId) ||
    members.find((m) => m.userId === currentUserId)?.role === 'master';

  const resetForm = () => {
    setName(document.name);
    setDescription(document.description);
    setVisibility(document.visibility);
    setTagIds(document.tagIds);
  };

  const handleSave = () => {
    updateDocument.mutate(
      { name, description, visibility, tagIds },
      {
        onSuccess: () => setEditing(false),
        onError: notifyError,
      },
    );
  };

  const handleCancel = () => {
    resetForm();
    setEditing(false);
  };

  const tagOptions = tags.map((t) => ({ value: t.id, label: t.name }));
  const documentTags = tags.filter((t) => document.tagIds.includes(t.id));
  const ownerOptions = members
    .filter((m) => !document.ownerIds.includes(m.userId))
    .map((m) => ({ value: m.userId, label: m.email ?? m.userId }));
  const emailFor = (userId: string) => members.find((m) => m.userId === userId)?.email ?? userId;

  return (
    <Stack gap="md" p="md">
      <Group>
        <Button
          component={Link}
          to={`/rooms/${roomId}/documents`}
          variant="subtle"
          leftSection={<ArrowLeftIcon size={16} />}
        >
          Documenti
        </Button>
      </Group>

      <Card withBorder padding="lg" radius="md" maw={720}>
        <Stack gap="md">
          <DocumentImageGallery
            images={document.images}
            documentName={document.name}
            canDelete={isOwner && editing}
            onDelete={(imageId) => deleteImage.mutate(imageId, { onError: notifyError })}
            deletingImageId={deleteImage.isPending ? (deleteImage.variables ?? null) : null}
          />

          <Group justify="space-between" align="flex-start" wrap="nowrap">
            {editing ? (
              <TextInput
                value={name}
                onChange={(event) => setName(event.currentTarget.value)}
                size="lg"
                style={{ flex: 1, fontFamily: 'var(--font-display)' }}
              />
            ) : (
              <Title order={1} style={{ fontFamily: 'var(--font-display)' }}>
                {document.name}
              </Title>
            )}
            <Group gap="xs" wrap="nowrap">
              <VisibilityBadge visibility={editing ? visibility : document.visibility} />
              {isOwner && !editing && (
                <ActionIcon
                  variant="subtle"
                  color="gray"
                  onClick={() => setEditing(true)}
                  aria-label="Modifica"
                >
                  <PencilSimpleIcon size={18} />
                </ActionIcon>
              )}
              {isOwner && editing && (
                <ActionIcon
                  variant="subtle"
                  color="gray"
                  onClick={handleCancel}
                  aria-label="Annulla modifiche"
                >
                  <XIcon size={18} />
                </ActionIcon>
              )}
            </Group>
          </Group>

          {editing ? (
            <Stack gap="sm">
              <Textarea
                label="Descrizione"
                value={description}
                onChange={(event) => setDescription(event.currentTarget.value)}
                minRows={4}
                autosize
              />
              <Select
                label="Visibilità"
                data={VISIBILITY_OPTIONS}
                value={visibility}
                onChange={(value) => setVisibility((value as DocumentVisibility | null) ?? 'room')}
                allowDeselect={false}
              />
              <MultiSelect
                label="Tag"
                data={tagOptions}
                value={tagIds}
                onChange={setTagIds}
                searchable
              />
              <AddDocumentImages
                onUploadFiles={(files) => uploadImages.mutate(files, { onError: notifyError })}
                uploading={uploadImages.isPending}
                onImportUrl={(url, onDone) =>
                  importImage.mutate(url, { onSuccess: onDone, onError: notifyError })
                }
                importing={importImage.isPending}
              />
              <Group>
                <Button onClick={handleSave} loading={updateDocument.isPending}>
                  Salva modifiche
                </Button>
                <Button variant="subtle" color="gray" onClick={handleCancel}>
                  Annulla
                </Button>
              </Group>
            </Stack>
          ) : (
            <>
              {documentTags.length > 0 && (
                <Group gap={6}>
                  {documentTags.map((tag) => (
                    <Text key={tag.id} size="xs" c="dimmed">
                      #{tag.name}
                    </Text>
                  ))}
                </Group>
              )}
              <Text style={{ whiteSpace: 'pre-wrap' }}>
                {document.description || 'Nessuna descrizione.'}
              </Text>
            </>
          )}

          <Divider />

          <Stack gap="xs">
            <Text fw={600} size="sm">
              Owner
            </Text>
            <Group gap="xs">
              {document.ownerIds.map((ownerId) => (
                <Badge
                  key={ownerId}
                  variant="outline"
                  color="gray"
                  rightSection={
                    isOwner ? (
                      <ActionIcon
                        size="xs"
                        variant="transparent"
                        color="gray"
                        onClick={() => removeOwner.mutate(ownerId, { onError: notifyError })}
                      >
                        <TrashIcon size={12} />
                      </ActionIcon>
                    ) : undefined
                  }
                >
                  {emailFor(ownerId)}
                </Badge>
              ))}
            </Group>
            {isOwner && (
              <Group gap="xs">
                <Select
                  placeholder="Aggiungi Owner"
                  data={ownerOptions}
                  value={addOwnerId}
                  onChange={setAddOwnerId}
                  searchable
                  style={{ flex: 1 }}
                />
                <Button
                  variant="light"
                  disabled={!addOwnerId}
                  onClick={() => {
                    if (addOwnerId) {
                      addOwner.mutate(addOwnerId, { onError: notifyError });
                      setAddOwnerId(null);
                    }
                  }}
                >
                  Aggiungi
                </Button>
              </Group>
            )}
          </Stack>
        </Stack>
      </Card>
    </Stack>
  );
}
