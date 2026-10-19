import { useEffect, useRef, useState } from 'react';
import { useMediaQuery } from '@mantine/hooks';
import { useNavigate } from 'react-router-dom';
import {
  Stack,
  Group,
  Title,
  Text,
  Button,
  Box,
  Modal,
  Alert,
  Paper,
  Divider,
} from '@mantine/core';
import {
  ClockCounterClockwiseIcon,
  DotsThreeVerticalIcon,
  DownloadSimpleIcon,
  EyeIcon,
  GraphIcon,
  PencilSimpleIcon,
  XIcon,
} from '@phosphor-icons/react';
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
} from '../../hooks/useDocuments';
import { useTags } from '../../hooks/useTags';
import { useMembers } from '../../hooks/useMembers';
import { useComments, usePromoteComment } from '../../hooks/useComments';
import { useRoom } from '../../hooks/useRooms';
import { useRevealDocument, useRevealedInVisit } from '../../hooks/useReveals';
import { useReadOnly } from '../../hooks/useViewAs';
import { useStopReadingOnLeave } from '../../hooks/useReadAloud';
import { useDocumentMentions } from '../../hooks/useDocumentMentions';
import { notifyError, notifySuccess } from '../../lib/notify';
import { appendPromotedText, promotionReaches, type PromotionAudience } from '../../lib/promotion';
import { canCreateDocuments, canManageTags } from '../../lib/roomPermissions';
import { documentReveal, notesHiddenFromGains } from '../../lib/reveal';
import { documentSpeech } from '../../lib/speech';
import { FullPageLoader, FullPageMessage } from '../PageState';
import { PageCard } from '../PageCard';
import { VisibilityBadge } from '../VisibilityBadge';
import { RevealedBadge } from '../RevealedBadge';
import { ExportDocumentModal } from '../ExportDocumentModal';
import { ReadAloudControls } from '../speech/ReadAloudControls';
import { RevealModal } from '../RevealModal';
import { TagList } from '../TagList';
import { DocumentFields } from '../DocumentFields';
import { DocumentOwners } from '../DocumentOwners';
import { VersionHistoryDrawer } from '../versions/VersionHistoryDrawer';
import { DocumentPlayer } from '../DocumentPlayer';
import { DocumentImageGallery } from '../DocumentImageGallery';
import { AddDocumentImages } from '../AddDocumentImages';
import { ImageSearchModal } from '../ImageSearchModal';
import { CommentSection } from '../comments/CommentSection';
import { PromoteToDocumentModal, WideningConfirmModal } from '../comments/CommentPromotion';
import { NoteList } from '../notes/NoteList';
import { DocumentFileList } from '../files/DocumentFileList';
import { DocumentMentionsProvider } from '../mentions/DocumentMentionsProvider';
import { MentionText } from '../mentions/MentionText';
import { Backlinks } from '../mentions/Backlinks';
import { MentionMapModal } from '../maps/MentionMapModal';
import { MentionMapPanel } from '../maps/MentionMapPanel';
import { LinkedMapPanel } from '../maps/LinkedMapPanel';
import { useLinkedMap, useMentionMap } from '../../hooks/useMentionMap';
import type { Comment, PromotionTarget } from '../../types/comment';
import type { Document, DocumentFormValues, DocumentVisibility } from '../../types/document';
import type { Member } from '../../types/member';
import type { Tag } from '../../types/tag';
import { useTranslation } from 'react-i18next';
import { LabeledActionIcon } from '../LabeledActionIcon';

/**
 * One Document as its page shows it: its panel (name, Tags, description,
 * Notes, gallery, Owners), where it is mentioned and its Comments. Owners and
 * the Master also get the editing controls, except while the Master previews
 * it as a member (spec 22b): then it is read-only. The Document page shows it,
 * and so does the half-screen pane (spec 37).
 */
export function DocumentView({
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
  // For the level new Notes and Comments start at (VR-05).
  const room = useRoom(roomId, true);
  const defaultVisibility = room.data?.defaultVisibility ?? 'room';
  // A Comment being promoted (spec 19c Decision 5), and where to.
  const [promoting, setPromoting] = useState<{
    comment: Comment;
    target: PromotionTarget;
  } | null>(null);
  const readOnly = useReadOnly();

  if (document.isLoading) {
    return <FullPageLoader />;
  }

  if (document.isError || !document.data) {
    return (
      <FullPageMessage
        actionLabel={t('documents.detail.backToDocuments')}
        actionTo={`/rooms/${roomId}/documents`}
      >
        {t('documents.detail.notFound')}
      </FullPageMessage>
    );
  }

  const memberList = members.data ?? [];
  const isMaster =
    memberList.find((m) => m.userId === currentUserId)?.role === 'master' && !readOnly;
  // A promotion starts from a Comment in this same cache, so it is loaded.
  const promotion = promoting && {
    comment: promoting.comment,
    reachedBy: (audience: PromotionAudience) =>
      promotionReaches(promoting.comment, comments.data!, memberList, audience),
  };

  return (
    <>
      <DocumentMentionsProvider roomId={roomId} currentUserId={currentUserId}>
        <DocumentPanel
          key={document.data.id}
          roomId={roomId}
          document={document.data}
          tags={tags.data ?? []}
          members={memberList}
          currentUserId={currentUserId}
          defaultVisibility={defaultVisibility}
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
          defaultVisibility={defaultVisibility}
          revealFrom={isMaster ? document.data : undefined}
          onPromote={readOnly ? undefined : (comment, target) => setPromoting({ comment, target })}
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
    </>
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
  defaultVisibility,
  promotion,
  onPromotionEnd,
}: {
  roomId: string;
  document: Document;
  tags: Tag[];
  members: Member[];
  currentUserId: string;
  /** The Room's starting level for new Notes (VR-05). */
  defaultVisibility: DocumentVisibility;
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
  const revealDocument = useRevealDocument(roomId, document.id);
  const revealed = useRevealedInVisit(roomId, document.id);
  const [revealing, setRevealing] = useState(false);
  const [historyOpened, setHistoryOpened] = useState(false);
  const [imageSearchOpened, setImageSearchOpened] = useState(false);
  const [exportOpened, setExportOpened] = useState(false);
  const [mentionMapOpened, setMentionMapOpened] = useState(false);
  const phone = useMediaQuery('(max-width: 48em)', false, { getInitialValueInEffect: false });
  const [actionsExpanded, setActionsExpanded] = useState(false);
  // Spec 36: the Document's mention map, drawn under its images when it has a
  // relation the viewer sees.
  const mentionMap = useMentionMap(roomId, document.id);
  // Spec 36 Decision 15: a free map linked to the Document, drawn there too.
  const linkedMap = useLinkedMap(roomId, document.id).data ?? null;
  const room = useRoom(roomId, true);
  // Previewing as a member (spec 22b): no write control at all.
  const readOnly = useReadOnly();
  // Spec 30: leaving the Document (or moving to another) stops reading it.
  useStopReadingOnLeave();
  const mentions = useDocumentMentions();

  const me = members.find((m) => m.userId === currentUserId);
  const isMaster = me?.role === 'master' && !readOnly;
  const isOwner = (document.ownerIds.includes(currentUserId) || isMaster) && !readOnly;
  const shownMap = mentionMap.data?.arrows.length ? mentionMap.data : null;
  // Spec 36 Decision 11: whoever may create maps opens the modal to create one;
  // once it exists, its creator and the Master open it to change it.
  const canOpenMentionMap =
    !readOnly && (mentionMap.data ? mentionMap.data.canManage : canCreateDocuments(me, room.data));

  const badges = (
    <>
      {revealed?.document && <RevealedBadge />}
      <VisibilityBadge visibility={document.visibility} compact={phone} />
    </>
  );
  // Spec 30: everyone who sees the Document can hear it: its name, description and the
  // Notes they see. Kept out of the folded actions so a phone can always stop the reading.
  const readAloud = (
    <ReadAloudControls
      sourceId={`document:${document.id}`}
      name={document.name}
      getText={() => documentSpeech(document, mentions)}
    />
  );
  const actions = (
    <>
      {/* Spec 22: the Master reveals what the whole Room doesn't see yet. */}
      {isMaster && document.visibility !== 'room' && (
        <LabeledActionIcon
          variant="subtle"
          color="gray"
          onClick={() => setRevealing(true)}
          aria-label={t('reveal.actionLabel', { name: document.name })}
        >
          <EyeIcon size={18} />
        </LabeledActionIcon>
      )}
      {/* Spec 27: every member who sees the Document exports it, as the member
          being previewed too (it only reads). */}
      <LabeledActionIcon
        variant="subtle"
        color="gray"
        onClick={() => setExportOpened(true)}
        aria-label={t('export.document.action')}
      >
        <DownloadSimpleIcon size={18} />
      </LabeledActionIcon>
      {canOpenMentionMap && (
        <LabeledActionIcon
          variant="subtle"
          color="gray"
          onClick={() => setMentionMapOpened(true)}
          aria-label={t('maps.mention.button')}
        >
          <GraphIcon size={18} />
        </LabeledActionIcon>
      )}
      {/* Spec 24b: Owners and the Master read the whole Document's history. */}
      {isOwner && (
        <LabeledActionIcon
          variant="subtle"
          color="gray"
          onClick={() => setHistoryOpened(true)}
          aria-label={t('versions.actionFor', { name: document.name })}
        >
          <ClockCounterClockwiseIcon size={18} />
        </LabeledActionIcon>
      )}
      {isOwner && (
        <LabeledActionIcon
          variant="subtle"
          color="gray"
          onClick={() => (editing ? stopEditing() : setEditing(true))}
          aria-label={editing ? t('documents.detail.cancelEditing') : t('common.edit')}
        >
          {editing ? <XIcon size={18} /> : <PencilSimpleIcon size={18} />}
        </LabeledActionIcon>
      )}
    </>
  );

  return (
    <PageCard>
      <Stack gap="md">
        {/* One line: the name (which may wrap to two lines and always stays visible), the
            badge, the read-aloud controls and a "⋮" that unfolds the other actions: beside it
            on a big screen, on a row of their own on a phone so they never squeeze the name
            (Andrea, 2026-10-15). */}
        <Group justify="space-between" align="flex-start" wrap="nowrap" preventGrowOverflow={false}>
          <Stack gap={0} style={{ minWidth: 0, flex: 1 }}>
            <Title
              order={1}
              fz={{ base: 'h2', sm: 'h1' }}
              style={{
                fontFamily: 'var(--font-display)',
                overflowWrap: 'anywhere',
              }}
            >
              {document.name}
            </Title>
            {/* Spec 28_0 S3: one typography level below the name, dimmed. */}
            {document.subtitle && (
              <Text
                fz={{ base: 'h3', sm: 'h2' }}
                c="dimmed"
                style={{
                  fontFamily: 'var(--font-display)',
                  overflowWrap: 'anywhere',
                }}
              >
                {document.subtitle}
              </Text>
            )}
          </Stack>
          <Group gap="xs" wrap="nowrap" preventGrowOverflow={false} style={{ flexShrink: 0 }}>
            {badges}
            {readAloud}
            {!phone && actionsExpanded && actions}
            <LabeledActionIcon
              variant="subtle"
              color="gray"
              aria-label={t('documents.detail.actions', { name: document.name })}
              aria-expanded={actionsExpanded}
              onClick={() => setActionsExpanded((current) => !current)}
            >
              <DotsThreeVerticalIcon size={18} />
            </LabeledActionIcon>
          </Group>
        </Group>
        {phone && actionsExpanded && (
          <Group gap="xs" wrap="wrap" preventGrowOverflow={false}>
            {actions}
          </Group>
        )}

        {/* The aside, on the right on big screens (spec 10, mirroring
            DocumentCard's layout in RoomDocumentsPage): the images, then the
            info panel (player, Owners, PDFs). Floated so the text wraps around
            it and takes the full width once past it; narrower when there are
            no images; stacked under the text below `lg` (`.document-body` in
            index.css). */}
        <Box className="document-body">
          <Box
            className="document-body-aside"
            data-narrow={(document.images.length === 0 && !shownMap && !linkedMap) || undefined}
          >
            <Stack gap="sm">
              {document.images.length > 0 && (
                <DocumentImageGallery
                  images={document.images}
                  documentName={document.name}
                  canDelete={isOwner && editing}
                  onDelete={(imageId) => deleteImage.mutate(imageId, { onError: notifyError })}
                  deletingImageId={deleteImage.isPending ? (deleteImage.variables as string) : null}
                  // Spec 07: not gated on `editing` like deletion - picking the
                  // leading image is reversible, so it needs no edit mode.
                  onSetFavorite={
                    isOwner
                      ? (imageId) => setFavorite.mutate(imageId, { onError: notifyError })
                      : undefined
                  }
                  settingFavoriteId={
                    setFavorite.isPending ? (setFavorite.variables as string) : null
                  }
                />
              )}
              {shownMap && <MentionMapPanel roomId={roomId} map={shownMap} />}
              {linkedMap && (
                <LinkedMapPanel
                  roomId={roomId}
                  documentId={document.id}
                  map={linkedMap}
                  canUnlink={!readOnly && linkedMap.canEdit}
                />
              )}
              <Paper withBorder radius="md" p="sm" bg="var(--mantine-color-dark-7)">
                <Stack gap={6}>
                  <DocumentPlayer
                    playedBy={document.playedBy}
                    members={members}
                    canManage={isOwner}
                    onSet={(userId, addAsOwner) =>
                      setPlayer.mutate({ userId, addAsOwner }, { onError: notifyError })
                    }
                    onUnlink={() =>
                      setPlayer.mutate(
                        { userId: null, addAsOwner: false },
                        { onError: notifyError },
                      )
                    }
                  />
                  <DocumentOwners
                    ownerIds={document.ownerIds}
                    members={members}
                    canManage={isOwner}
                    onAdd={(userId) => addOwner.mutate(userId, { onError: notifyError })}
                    onRemove={(userId) => removeOwner.mutate(userId, { onError: notifyError })}
                  />
                  {/* Spec 16: the PDFs. Like the Document itself, every reader
                      sees them (VR-12); with none, only an Owner sees the row.
                      The image upload sits in the same section, in a row
                      shaped like the PDFs' one, for whoever may add images
                      (no need to enter edit mode). */}
                  {(document.files.length > 0 || isOwner || editing) && (
                    <>
                      <Divider my={4} />
                      {(isOwner || editing) && (
                        <AddDocumentImages
                          onUploadFiles={(files) =>
                            uploadImages.mutate(files, { onError: notifyError })
                          }
                          uploading={uploadImages.isPending}
                          onImportUrl={(url, onDone) =>
                            importImage.mutate(url, {
                              onSuccess: onDone,
                              onError: notifyError,
                            })
                          }
                          importing={importImage.isPending}
                          onSearch={() => setImageSearchOpened(true)}
                        />
                      )}
                      <DocumentFileList
                        roomId={roomId}
                        documentId={document.id}
                        files={document.files}
                        canUpload={isOwner}
                      />
                    </>
                  )}
                </Stack>
              </Paper>
            </Stack>
          </Box>
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
              defaultVisibility={defaultVisibility}
              revealFrom={isMaster ? document : undefined}
            />
          </Stack>
        </Box>
      </Stack>
      {mentionMapOpened && (
        <MentionMapModal
          roomId={roomId}
          documentId={document.id}
          documentName={document.name}
          map={mentionMap.data ?? null}
          onClose={() => setMentionMapOpened(false)}
        />
      )}
      {isOwner && (
        <VersionHistoryDrawer
          opened={historyOpened}
          onClose={() => setHistoryOpened(false)}
          roomId={roomId}
          documentId={document.id}
          name={document.name}
          members={members}
        />
      )}
      {/* Mounted only while open, so each opening starts a fresh search. */}
      {imageSearchOpened && (
        <ImageSearchModal
          opened
          onClose={() => setImageSearchOpened(false)}
          roomId={roomId}
          documentId={document.id}
          onAdd={(url, onDone) =>
            importImage.mutate(url, { onSuccess: onDone, onError: notifyError })
          }
          addingUrl={importImage.isPending ? importImage.variables : null}
        />
      )}
      <ExportDocumentModal
        opened={exportOpened}
        onClose={() => setExportOpened(false)}
        roomId={roomId}
        documentId={document.id}
        documentName={document.name}
      />
      {revealing && (
        <RevealModal
          name={document.name}
          members={members}
          {...documentReveal(document, members)}
          hiddenNotes={(gains) => notesHiddenFromGains(document, gains)}
          loading={revealDocument.isPending}
          onConfirm={(audience, noteIds) =>
            revealDocument.mutate(
              { audience, noteIds },
              {
                onSuccess: () => {
                  notifySuccess(t('reveal.done'));
                  setRevealing(false);
                },
                onError: notifyError,
              },
            )
          }
          onClose={() => setRevealing(false)}
        />
      )}
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
    subtitle: document.subtitle ?? '',
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
