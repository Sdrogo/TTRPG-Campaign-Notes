import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { Stack, Group, Title, Text, Button, Divider, ActionIcon } from '@mantine/core';
import { PencilSimpleIcon, XIcon } from '@phosphor-icons/react';
import { useSession } from '../hooks/useSession';
import {
  useDocument,
  useUpdateDocument,
  useAddDocumentOwner,
  useRemoveDocumentOwner,
  useUploadDocumentImages,
  useImportDocumentImage,
  useDeleteDocumentImage,
  useSetFavoriteImage,
} from '../hooks/useDocuments';
import { useTags } from '../hooks/useTags';
import { useMembers } from '../hooks/useMembers';
import { notifyError } from '../lib/notify';
import { FullPageLoader, FullPageMessage, SignInRequired } from '../components/PageState';
import { PageLayout } from '../components/PageLayout';
import { PageCard } from '../components/PageCard';
import { VisibilityBadge } from '../components/VisibilityBadge';
import { TagList } from '../components/TagList';
import { DocumentFields } from '../components/DocumentFields';
import { DocumentOwners } from '../components/DocumentOwners';
import { DocumentImageGallery } from '../components/DocumentImageGallery';
import { AddDocumentImages } from '../components/AddDocumentImages';
import { CommentSection } from '../components/comments/CommentSection';
import { DocumentMentionsProvider } from '../components/mentions/DocumentMentionsProvider';
import { MentionText } from '../components/mentions/MentionText';
import type { Document, DocumentFormValues } from '../types/document';
import type { Member } from '../types/member';
import type { Tag } from '../types/tag';

export function DocumentDetailPage() {
  const { roomId, documentId } = useParams<{ roomId: string; documentId: string }>();
  const { session, loading: sessionLoading } = useSession();

  if (!roomId || !documentId) {
    return null;
  }

  if (sessionLoading) {
    return <FullPageLoader />;
  }

  if (!session) {
    return <SignInRequired>Accedi per vedere questo Documento.</SignInRequired>;
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
    return <FullPageLoader />;
  }

  if (document.isError || !document.data) {
    return (
      <FullPageMessage actionLabel="Torna ai Documenti" actionTo={`/rooms/${roomId}/documents`}>
        Documento non trovato o non visibile.
      </FullPageMessage>
    );
  }

  return (
    <PageLayout backTo={`/rooms/${roomId}/documents`} backLabel="Documenti">
      <DocumentMentionsProvider roomId={roomId} currentUserId={currentUserId}>
        <DocumentPanel
          key={document.data.id}
          roomId={roomId}
          document={document.data}
          tags={tags.data ?? []}
          members={members.data ?? []}
          currentUserId={currentUserId}
        />
        <CommentSection
          roomId={roomId}
          documentId={document.data.id}
          members={members.data ?? []}
          currentUserId={currentUserId}
        />
      </DocumentMentionsProvider>
    </PageLayout>
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
  const addOwner = useAddDocumentOwner(roomId, document.id);
  const removeOwner = useRemoveDocumentOwner(roomId, document.id);
  const uploadImages = useUploadDocumentImages(roomId, document.id);
  const importImage = useImportDocumentImage(roomId, document.id);
  const deleteImage = useDeleteDocumentImage(roomId, document.id);
  const setFavorite = useSetFavoriteImage(roomId, document.id);

  const isOwner =
    document.ownerIds.includes(currentUserId) ||
    members.find((m) => m.userId === currentUserId)?.role === 'master';

  return (
    <PageCard>
      <Stack gap="md">
        <Group justify="space-between" align="flex-start" wrap="nowrap" preventGrowOverflow={false}>
          <Title
            order={1}
            fz={{ base: 'h2', sm: 'h1' }}
            style={{ fontFamily: 'var(--font-display)', minWidth: 0, overflowWrap: 'anywhere' }}
          >
            {document.name}
          </Title>
          <Group gap="xs" wrap="nowrap" preventGrowOverflow={false} style={{ flexShrink: 0 }}>
            <VisibilityBadge visibility={document.visibility} />
            {isOwner && (
              <ActionIcon
                variant="subtle"
                color="gray"
                onClick={() => setEditing((current) => !current)}
                aria-label={editing ? 'Annulla modifiche' : 'Modifica'}
              >
                {editing ? <XIcon size={18} /> : <PencilSimpleIcon size={18} />}
              </ActionIcon>
            )}
          </Group>
        </Group>

        {editing ? (
          <Stack gap="md">
            <AddDocumentImages
              onUploadFiles={(files) => uploadImages.mutate(files, { onError: notifyError })}
              uploading={uploadImages.isPending}
              onImportUrl={(url, onDone) =>
                importImage.mutate(url, { onSuccess: onDone, onError: notifyError })
              }
              importing={importImage.isPending}
            />
            <DocumentEditForm
              roomId={roomId}
              document={document}
              tags={tags}
              onDone={() => setEditing(false)}
            />
          </Stack>
        ) : (
          <>
            <TagList tags={tags} tagIds={document.tagIds} />
            {document.description ? (
              <MentionText
                text={document.description}
                style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}
              />
            ) : (
              <Text c="dimmed">Nessuna descrizione.</Text>
            )}
          </>
        )}

        <Divider />
        <DocumentImageGallery
          images={document.images}
          documentName={document.name}
          canDelete={isOwner && editing}
          onDelete={(imageId) => deleteImage.mutate(imageId, { onError: notifyError })}
          deletingImageId={deleteImage.isPending ? (deleteImage.variables ?? null) : null}
          // Spec 07: not gated on `editing` like deletion - picking the
          // leading image is reversible, so it needs no edit mode.
          onSetFavorite={
            isOwner ? (imageId) => setFavorite.mutate(imageId, { onError: notifyError }) : undefined
          }
          settingFavoriteId={setFavorite.isPending ? (setFavorite.variables ?? null) : null}
        />
        <DocumentOwners
          ownerIds={document.ownerIds}
          members={members}
          canManage={isOwner}
          onAdd={(userId) => addOwner.mutate(userId, { onError: notifyError })}
          onRemove={(userId) => removeOwner.mutate(userId, { onError: notifyError })}
        />
      </Stack>
    </PageCard>
  );
}

// Mounted fresh each time editing starts, so its state is initialized from
// the saved Document and "cancel" is just unmounting it.
function DocumentEditForm({
  roomId,
  document,
  tags,
  onDone,
}: {
  roomId: string;
  document: Document;
  tags: Tag[];
  onDone: () => void;
}) {
  const updateDocument = useUpdateDocument(roomId, document.id);
  const [values, setValues] = useState<DocumentFormValues>({
    name: document.name,
    description: document.description,
    visibility: document.visibility,
    tagIds: document.tagIds,
  });

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    updateDocument.mutate(values, { onSuccess: onDone, onError: notifyError });
  };

  return (
    <form onSubmit={handleSubmit}>
      <Stack gap="sm">
        <DocumentFields values={values} onChange={setValues} tags={tags} />
        <Group>
          <Button type="submit" loading={updateDocument.isPending} disabled={!values.name.trim()}>
            Salva modifiche
          </Button>
          <Button variant="subtle" color="gray" onClick={onDone}>
            Annulla
          </Button>
        </Group>
      </Stack>
    </form>
  );
}
