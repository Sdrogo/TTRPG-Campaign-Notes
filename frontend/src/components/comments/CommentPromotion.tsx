import { useState } from 'react';
import { Button, Checkbox, Group, Image, Modal, Stack, Text } from '@mantine/core';
import { useQueryClient } from '@tanstack/react-query';
import { DocumentFields } from '../DocumentFields';
import { usePromoteComment } from '../../hooks/useComments';
import { importDocumentImage, useCreateDocument } from '../../hooks/useDocuments';
import { useTags } from '../../hooks/useTags';
import { memberDisplayName } from '../../lib/members';
import { notifyError, notifySuccess } from '../../lib/notify';
import { promotedText, startingVisibility, type PromotionAudience } from '../../lib/promotion';
import type { Comment } from '../../types/comment';
import type { Document, DocumentFormValues } from '../../types/document';
import type { Member } from '../../types/member';
import { useTranslation } from 'react-i18next';

interface WideningConfirmModalProps {
  opened: boolean;
  /** The members the text would newly reach. */
  reached: Member[];
  onConfirm: () => void;
  onCancel: () => void;
  loading?: boolean;
}

/**
 * The warning before a promotion shows a Comment's text to members who can't
 * read the Comment now (spec 19c Decision 5): names them, and goes ahead only
 * on an explicit confirmation. Recorded in the AuditLog by the backend.
 */
export function WideningConfirmModal({
  opened,
  reached,
  onConfirm,
  onCancel,
  loading = false,
}: WideningConfirmModalProps) {
  const { t } = useTranslation();
  return (
    <Modal
      opened={opened}
      onClose={onCancel}
      title={t('comments.promotion.wideningTitle')}
      centered
    >
      <Stack gap="md">
        <Text size="sm">
          {t('comments.promotion.wideningBody', {
            names: reached.map(memberDisplayName).join(', '),
          })}
        </Text>
        <Group justify="flex-end">
          <Button variant="subtle" color="gray" onClick={onCancel}>
            {t('common.cancel')}
          </Button>
          <Button color="orange" loading={loading} onClick={onConfirm}>
            {t('comments.promotion.wideningConfirm')}
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}

interface PromoteToDocumentModalProps {
  roomId: string;
  /** The Document the Comment is on. */
  documentId: string;
  comment: Comment;
  currentUserId: string;
  /** Whether the viewer may add a Tag inline (Administrator or Master). */
  canManageTags: boolean;
  /** The members a new Document with this audience would newly show the text to. */
  reachedBy: (audience: PromotionAudience) => Member[];
  onClose: () => void;
}

/**
 * Promotes a Comment into a new Document (spec 19c Decision 5): the creation
 * form, prefilled with the Comment's text and offering its images, starting at
 * a visibility that widens nothing. Saving creates the Document (its creator
 * becomes its Owner), copies the chosen images into it, then records the
 * promotion, which links the Comment to it. A visibility that would widen who
 * reads the text asks for confirmation first.
 */
export function PromoteToDocumentModal({
  roomId,
  documentId,
  comment,
  currentUserId,
  canManageTags,
  reachedBy,
  onClose,
}: PromoteToDocumentModalProps) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const tags = useTags(roomId, true);
  const createDocument = useCreateDocument(roomId);
  const promote = usePromoteComment(roomId, documentId);
  const [values, setValues] = useState<DocumentFormValues>({
    name: '',
    description: promotedText(comment),
    visibility: startingVisibility(comment),
    tagIds: [],
  });
  const [imageIds, setImageIds] = useState(comment.images.map((image) => image.id));
  const [tagCreatePending, setTagCreatePending] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [saving, setSaving] = useState(false);

  // The new Document has only its creator as Owner and no Selective grants.
  const reached = reachedBy({
    visibility: values.visibility,
    ownerIds: [currentUserId],
    selectiveUserIds: [],
  });

  const save = async () => {
    setConfirming(false);
    setSaving(true);
    let created: Document;
    try {
      created = await createDocument.mutateAsync(values);
    } catch (error) {
      notifyError(error);
      setSaving(false);
      return;
    }
    // From here the Document exists: whatever happens next, the form closes,
    // so a retry can't create a second one.
    void queryClient.invalidateQueries({ queryKey: ['rooms', roomId, 'documents'] });
    const failed: string[] = [];
    for (const image of comment.images.filter((image) => imageIds.includes(image.id))) {
      try {
        await importDocumentImage(roomId, created.id, image.url);
      } catch (error) {
        failed.push(error instanceof Error ? error.message : String(error));
      }
    }
    try {
      await promote.mutateAsync({
        commentId: comment.id,
        target: 'document',
        documentId: created.id,
        confirmWidening: reached.length > 0,
      });
      if (failed.length > 0) {
        notifyError(new Error(t('comments.promotion.imageErrors', { errors: failed.join('; ') })));
      } else {
        notifySuccess(t('comments.promotion.done'));
      }
    } catch (error) {
      // A mutation's error is an Error (TanStack Query's default).
      const reason = (error as Error).message;
      notifyError(new Error(t('comments.promotion.notRecorded', { reason })));
    }
    setSaving(false);
    onClose();
  };

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    // A tag still being created is added to `values` only once it exists.
    if (tagCreatePending) return;
    if (reached.length > 0) {
      setConfirming(true);
    } else {
      void save();
    }
  };

  return (
    <>
      <Modal opened onClose={onClose} title={t('comments.promotion.modalTitle')} centered>
        <form onSubmit={handleSubmit}>
          <Stack gap="sm">
            <DocumentFields
              values={values}
              onChange={setValues}
              tags={tags.data ?? []}
              roomId={roomId}
              canCreateTag={canManageTags}
              onTagCreatePendingChange={setTagCreatePending}
              autoFocus
            />
            {comment.images.length > 0 && (
              <Checkbox.Group
                label={t('comments.promotion.images')}
                value={imageIds}
                onChange={setImageIds}
              >
                <Stack gap={4} mt={4}>
                  {comment.images.map((image, index) => (
                    <Checkbox
                      key={image.id}
                      value={image.id}
                      label={
                        <Group gap="xs" wrap="nowrap">
                          <Image src={image.url} w={40} h={40} radius="sm" alt="" />
                          {t('comments.promotion.imageLabel', { index: index + 1 })}
                        </Group>
                      }
                    />
                  ))}
                </Stack>
              </Checkbox.Group>
            )}
            <Button
              type="submit"
              loading={saving}
              disabled={!values.name.trim() || tagCreatePending}
            >
              {t('documents.create')}
            </Button>
          </Stack>
        </form>
      </Modal>
      <WideningConfirmModal
        opened={confirming}
        reached={reached}
        onConfirm={() => void save()}
        onCancel={() => setConfirming(false)}
      />
    </>
  );
}
