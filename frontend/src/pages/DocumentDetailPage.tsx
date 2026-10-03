import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Stack, Group, Title, Text, Button, Box, ActionIcon, Modal, Alert } from '@mantine/core';
import { PencilSimpleIcon, XIcon } from '@phosphor-icons/react';
import { useSession } from '../hooks/useSession';
import {
  useDocument,
  useUpdateDocument,
  useDeleteDocument,
  useAddDocumentOwner,
  useRemoveDocumentOwner,
  useUploadDocumentImages,
  useImportDocumentImage,
  useDeleteDocumentImage,
  useSetFavoriteImage,
  useSetDocumentPlayer,
} from '../hooks/useDocuments';
import { useTags } from '../hooks/useTags';
import { useMembers } from '../hooks/useMembers';
import { useComments, usePromoteComment } from '../hooks/useComments';
import { notifyError, notifySuccess } from '../lib/notify';
import { appendPromotedText, promotionReaches, type PromotionAudience } from '../lib/promotion';
import { canManageTags } from '../lib/roomPermissions';
import { FullPageLoader, FullPageMessage, SignInRequired } from '../components/PageState';
import { PageLayout } from '../components/PageLayout';
import { PageCard } from '../components/PageCard';
import { VisibilityBadge } from '../components/VisibilityBadge';
import { TagList } from '../components/TagList';
import { DocumentFields } from '../components/DocumentFields';
import { DocumentOwners } from '../components/DocumentOwners';
import { DocumentPlayer } from '../components/DocumentPlayer';
import { DocumentImageGallery } from '../components/DocumentImageGallery';
import { AddDocumentImages } from '../components/AddDocumentImages';
import { CommentSection } from '../components/comments/CommentSection';
import { PromoteToDocumentModal, WideningConfirmModal } from '../components/comments/CommentPromotion';
import { NoteList } from '../components/notes/NoteList';
import { DocumentFileList } from '../components/files/DocumentFileList';
import { DocumentMentionsProvider } from '../components/mentions/DocumentMentionsProvider';
import { MentionText } from '../components/mentions/MentionText';
import { Backlinks } from '../components/mentions/Backlinks';
import type { Comment, PromotionTarget } from '../types/comment';
import type { Document, DocumentFormValues } from '../types/document';
import type { Member } from '../types/member';
import type { Tag } from '../types/tag';
import { useTranslation } from 'react-i18next';

/**
 * `/rooms/:roomId/documents/:documentId`: one Document with its gallery, Owners,
 * where it is mentioned and its Comments. Owners and the Master also get the editing controls.
 */
export function DocumentDetailPage() {
  const { t } = useTranslation();
  const { roomId, documentId } = useParams<{ roomId: string; documentId: string }>();
  const { session, loading: sessionLoading } = useSession();

  if (!roomId || !documentId) {
    return null;
  }

  if (sessionLoading) {
    return <FullPageLoader />;
  }

  if (!session) {
    return <SignInRequired>{t('documents.detail.signInRequired')}</SignInRequired>;
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
  const { t } = useTranslation();
  const document = useDocument(roomId, documentId, true);
  const tags = useTags(roomId, true);
  const members = useMembers(roomId, true);
  // The same query as the Comment section's: the Thread, for the parents of
  // a promoted reply.
  const comments = useComments(roomId, documentId, true);
  // A Comment being promoted (spec 19c Decision 5), and where to.
  const [promoting, setPromoting] = useState<{ comment: Comment; target: PromotionTarget } | null>(null);

  if (document.isLoading) {
    return <FullPageLoader />;
  }

  if (document.isError || !document.data) {
    return (
      <FullPageMessage actionLabel={t('documents.detail.backToDocuments')} actionTo={`/rooms/${roomId}/documents`}>
        {t('documents.detail.notFound')}
      </FullPageMessage>
    );
  }

  const memberList = members.data ?? [];
  // A promotion starts from a Comment in this same cache, so it is loaded.
  const promotion = promoting && {
    comment: promoting.comment,
    reachedBy: (audience: PromotionAudience) =>
      promotionReaches(promoting.comment, comments.data!, memberList, audience),
  };

  return (
    <PageLayout backTo={`/rooms/${roomId}/documents`} backLabel={t('documents.title')} roomId={roomId}>
      <DocumentMentionsProvider roomId={roomId} currentUserId={currentUserId}>
        <DocumentPanel
          key={document.data.id}
          roomId={roomId}
          document={document.data}
          tags={tags.data ?? []}
          members={memberList}
          currentUserId={currentUserId}
          promotion={promoting?.target === 'description' ? promotion : null}
          onPromotionEnd={() => setPromoting(null)}
        />
        {/* Spec 20 Decision 6: between the Notes and the Comments. */}
        <Backlinks
          roomId={roomId}
          target={{ kind: 'document', id: document.data.id }}
          members={memberList}
        />
        <CommentSection
          roomId={roomId}
          documentId={document.data.id}
          members={memberList}
          currentUserId={currentUserId}
          onPromote={(comment, target) => setPromoting({ comment, target })}
        />
        {promotion && promoting.target === 'document' && (
          <PromoteToDocumentModal
            roomId={roomId}
            documentId={document.data.id}
            comment={promotion.comment}
            currentUserId={currentUserId}
            canManageTags={canManageTags(memberList.find((m) => m.userId === currentUserId))}
            reachedBy={promotion.reachedBy}
            onClose={() => setPromoting(null)}
          />
        )}
      </DocumentMentionsProvider>
    </PageLayout>
  );
}

/**
 * A Comment whose text is being promoted into the description (spec 19c
 * Decision 5), and who a given audience would newly show it to.
 */
interface DescriptionPromotion {
  comment: Comment;
  reachedBy: (audience: PromotionAudience) => Member[];
}

function DocumentPanel({
  roomId,
  document,
  tags,
  members,
  currentUserId,
  promotion,
  onPromotionEnd,
}: {
  roomId: string;
  document: Document;
  tags: Tag[];
  members: Member[];
  currentUserId: string;
  /** Opens the editor with the Comment's text added to the description. */
  promotion: DescriptionPromotion | null;
  /** The promotion was saved or given up. */
  onPromotionEnd: () => void;
}) {
  const { t } = useTranslation();
  const [editingByHand, setEditing] = useState(false);
  const editing = editingByHand || promotion !== null;
  const stopEditing = () => {
    setEditing(false);
    if (promotion) onPromotionEnd();
  };
  const addOwner = useAddDocumentOwner(roomId, document.id);
  const removeOwner = useRemoveDocumentOwner(roomId, document.id);
  const uploadImages = useUploadDocumentImages(roomId, document.id);
  const importImage = useImportDocumentImage(roomId, document.id);
  const deleteImage = useDeleteDocumentImage(roomId, document.id);
  const setFavorite = useSetFavoriteImage(roomId, document.id);
  const setPlayer = useSetDocumentPlayer(roomId, document.id);

  const isOwner =
    document.ownerIds.includes(currentUserId) ||
    members.find((m) => m.userId === currentUserId)?.role === 'master';
  const me = members.find((m) => m.userId === currentUserId);

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
                onClick={() => (editing ? stopEditing() : setEditing(true))}
                aria-label={editing ? t('documents.detail.cancelEditing') : t('common.edit')}
              >
                {editing ? <XIcon size={18} /> : <PencilSimpleIcon size={18} />}
              </ActionIcon>
            )}
          </Group>
        </Group>

        {editing && (
          <AddDocumentImages
            onUploadFiles={(files) => uploadImages.mutate(files, { onError: notifyError })}
            uploading={uploadImages.isPending}
            onImportUrl={(url, onDone) =>
              importImage.mutate(url, { onSuccess: onDone, onError: notifyError })
            }
            importing={importImage.isPending}
          />
        )}

        {/* Images on the right on big screens (spec 10, mirroring
            DocumentCard's layout in RoomDocumentsPage), floated so the text
            wraps around them and takes the full width once it is past them;
            stacked under the text below `lg` (`.document-body` in index.css). */}
        <Box className="document-body">
          {document.images.length > 0 && (
            <Box className="document-body-images">
              <DocumentImageGallery
                images={document.images}
                documentName={document.name}
                canDelete={isOwner && editing}
                onDelete={(imageId) => deleteImage.mutate(imageId, { onError: notifyError })}
                deletingImageId={deleteImage.isPending ? (deleteImage.variables as string) : null}
                // Spec 07: not gated on `editing` like deletion - picking the
                // leading image is reversible, so it needs no edit mode.
                onSetFavorite={
                  isOwner ? (imageId) => setFavorite.mutate(imageId, { onError: notifyError }) : undefined
                }
                settingFavoriteId={setFavorite.isPending ? (setFavorite.variables as string) : null}
              />
            </Box>
          )}
          <Stack gap="md" className="document-body-text">
            {editing ? (
              <DocumentEditForm
                roomId={roomId}
                document={document}
                tags={tags}
                canManageTags={canManageTags(me)}
                promotion={promotion}
                onDone={stopEditing}
              />
            ) : (
              <Stack gap="xs" className="document-description">
                <TagList tags={tags} tagIds={document.tagIds} roomId={roomId} />
                {document.description ? (
                  <MentionText
                    text={document.description}
                    style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}
                  />
                ) : (
                  <Text c="dimmed">{t('common.noDescription')}</Text>
                )}
              </Stack>
            )}
            {/* Spec 12: each Note the viewer may see is a paragraph under the
                description. The backend already left out the hidden ones. */}
            <NoteList
              roomId={roomId}
              documentId={document.id}
              notes={document.notes}
              members={members}
              canAdd={isOwner}
            />
          </Stack>
        </Box>

        {/* Spec 16: the PDFs, under the text and the gallery. Like the
            Document itself, every reader sees them (VR-12). */}
        <DocumentFileList
          roomId={roomId}
          documentId={document.id}
          files={document.files}
          canUpload={isOwner}
        />

        <DocumentPlayer
          playedBy={document.playedBy}
          members={members}
          canManage={isOwner}
          onSet={(userId, addAsOwner) =>
            setPlayer.mutate({ userId, addAsOwner }, { onError: notifyError })
          }
          onUnlink={() =>
            setPlayer.mutate({ userId: null, addAsOwner: false }, { onError: notifyError })
          }
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
  canManageTags,
  promotion,
  onDone,
}: {
  roomId: string;
  document: Document;
  tags: Tag[];
  canManageTags: boolean;
  promotion: DescriptionPromotion | null;
  onDone: () => void;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const updateDocument = useUpdateDocument(roomId, document.id);
  const deleteDocument = useDeleteDocument(roomId, document.id);
  const promote = usePromoteComment(roomId, document.id);
  const [values, setValues] = useState<DocumentFormValues>({
    name: document.name,
    description: promotion
      ? appendPromotedText(document.description, promotion.comment)
      : document.description,
    visibility: document.visibility,
    tagIds: document.tagIds,
  });
  const [tagCreatePending, setTagCreatePending] = useState(false);
  const [confirmDeleteOpened, setConfirmDeleteOpened] = useState(false);
  const [confirmWideningOpened, setConfirmWideningOpened] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);

  // A promotion started while the form is already open adds its text to what
  // is being typed, keeping the unsaved edits.
  const promotedId = promotion?.comment.id ?? null;
  const [appendedFor, setAppendedFor] = useState(promotedId);
  if (promotion && promotedId !== appendedFor) {
    setAppendedFor(promotedId);
    setValues((current) => ({
      ...current,
      description: appendPromotedText(current.description, promotion.comment),
    }));
  }

  // A promotion starts from a Comment further down the page: bring the
  // editor into view.
  useEffect(() => {
    if (promotedId) formRef.current!.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [promotedId]);

  // Who the promoted text would newly reach with the visibility being saved.
  const reached = promotion
    ? promotion.reachedBy({
        visibility: values.visibility,
        ownerIds: document.ownerIds,
        selectiveUserIds: document.selectiveUserIds,
      })
    : [];

  // Saves the description, then records the promotion (spec 19c Decision 5).
  const save = () => {
    setConfirmWideningOpened(false);
    updateDocument.mutate(values, {
      onSuccess: () => {
        if (!promotion) {
          onDone();
          return;
        }
        // The form stays until the promotion settles: closing it unmounts
        // this component, and `mutate`'s callbacks would then never run.
        promote.mutate(
          {
            commentId: promotion.comment.id,
            target: 'description',
            confirmWidening: reached.length > 0,
          },
          {
            onSuccess: () => notifySuccess(t('comments.promotion.done')),
            onError: notifyError,
            onSettled: onDone,
          },
        );
      },
      onError: notifyError,
    });
  };

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    if (tagCreatePending) return;
    if (reached.length > 0) {
      setConfirmWideningOpened(true);
    } else {
      save();
    }
  };

  const handleDelete = () => {
    deleteDocument.mutate(undefined, {
      onSuccess: () => navigate(`/rooms/${roomId}/documents`),
      onError: notifyError,
    });
  };

  return (
    <form ref={formRef} onSubmit={handleSubmit}>
      <Stack gap="sm">
        {promotion && (
          <Alert color="accent" variant="light">
            {t('comments.promotion.editorNotice')}
          </Alert>
        )}
        <DocumentFields
          values={values}
          onChange={setValues}
          tags={tags}
          roomId={roomId}
          canCreateTag={canManageTags}
          onTagCreatePendingChange={setTagCreatePending}
        />
        <Group justify="space-between">
          <Group>
            <Button
              type="submit"
              loading={updateDocument.isPending || promote.isPending}
              disabled={!values.name.trim() || tagCreatePending}
            >
              {t('documents.detail.saveChanges')}
            </Button>
            <Button variant="subtle" color="gray" onClick={onDone}>
              {t('common.cancel')}
            </Button>
          </Group>
          <Button variant="outline" color="red" onClick={() => setConfirmDeleteOpened(true)}>
            {t('documents.detail.deleteDocument')}
          </Button>
        </Group>
      </Stack>

      <WideningConfirmModal
        opened={confirmWideningOpened}
        reached={reached}
        onConfirm={save}
        onCancel={() => setConfirmWideningOpened(false)}
      />

      <Modal
        opened={confirmDeleteOpened}
        onClose={() => setConfirmDeleteOpened(false)}
        title={t('documents.detail.deleteConfirmTitle')}
        centered
      >
        <Stack gap="md">
          <Text size="sm">{t('documents.detail.deleteConfirmBody')}</Text>
          <Group justify="flex-end">
            <Button variant="subtle" color="gray" onClick={() => setConfirmDeleteOpened(false)}>
              {t('common.cancel')}
            </Button>
            <Button color="red" loading={deleteDocument.isPending} onClick={handleDelete}>
              {t('common.delete')}
            </Button>
          </Group>
        </Stack>
      </Modal>
    </form>
  );
}
