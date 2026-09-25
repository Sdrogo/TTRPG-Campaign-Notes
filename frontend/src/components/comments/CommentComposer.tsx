import { useEffect, useRef, useState } from 'react';
import { Button, Group, Stack } from '@mantine/core';
import { PaperPlaneRightIcon } from '@phosphor-icons/react';
import { VisibilitySelect } from '../VisibilitySelect';
import { MemberMultiSelect } from '../MemberMultiSelect';
import { MentionTextarea } from '../mentions/MentionTextarea';
import { ImageAttachButtons } from '../ImageAttachButtons';
import { ImageThumbnailGrid, type Thumbnail } from '../ImageThumbnailGrid';
import {
  pendingFromFile,
  pendingFromUrl,
  releasePendingImages,
  remainingImageSlots,
} from '../../lib/images';
import type { CommentFormValues } from '../../types/comment';
import type { StoredImage } from '../../types/image';
import type { Member } from '../../types/member';
import { useTranslation } from 'react-i18next';

const EMPTY_COMMENT_VALUES: CommentFormValues = {
  body: '',
  visibility: 'room',
  selectiveUserIds: [],
  newImages: [],
  removedImageIds: [],
};

interface CommentComposerProps {
  members: Member[];
  currentUserId: string;
  submitLabel: string;
  /** Called with the values; call `reset` once they're saved to clear the form. */
  onSubmit: (values: CommentFormValues, reset: () => void) => void;
  submitting: boolean;
  initialValues?: CommentFormValues;
  /** Images already attached (when editing); each can be marked for removal. */
  existingImages?: StoredImage[];
  onCancel?: () => void;
  autoFocus?: boolean;
}

/**
 * Body, visibility and images for a Comment. Used both to write a new Comment
 * and to edit one in place, so the two never drift apart. Images are only
 * staged here; they're uploaded when the Comment is saved.
 */
export function CommentComposer({
  members,
  currentUserId,
  submitLabel,
  onSubmit,
  submitting,
  initialValues = EMPTY_COMMENT_VALUES,
  existingImages = [],
  onCancel,
  autoFocus,
}: CommentComposerProps) {
  const { t } = useTranslation();
  const [values, setValues] = useState<CommentFormValues>(initialValues);
  const set = (patch: Partial<CommentFormValues>) =>
    setValues((current) => ({ ...current, ...patch }));
  const canSubmit = values.body.trim() !== '' && !submitting;

  // Staged local files are previewed through object URLs: free them when
  // the composer goes away without saving.
  const pendingRef = useRef(values.newImages);
  useEffect(() => {
    pendingRef.current = values.newImages;
  }, [values.newImages]);
  useEffect(() => () => releasePendingImages(pendingRef.current), []);

  const keptImages = existingImages.filter((image) => !values.removedImageIds.includes(image.id));
  const remaining = remainingImageSlots(
    existingImages.length,
    values.removedImageIds.length,
    values.newImages.length,
  );
  const thumbnails: Thumbnail[] = [
    ...keptImages.map((image) => ({ id: image.id, url: image.url, label: t('comments.attachedImage') })),
    ...values.newImages.map((image) => ({ id: image.id, url: image.previewUrl, label: image.label })),
  ];

  const removeThumbnail = (id: string) => {
    const pending = values.newImages.find((image) => image.id === id);
    if (pending) {
      releasePendingImages([pending]);
      set({ newImages: values.newImages.filter((image) => image.id !== id) });
    } else {
      set({ removedImageIds: [...values.removedImageIds, id] });
    }
  };

  const reset = () => {
    releasePendingImages(values.newImages);
    setValues(EMPTY_COMMENT_VALUES);
  };

  const submit = () => {
    if (canSubmit) {
      onSubmit(values, reset);
    }
  };

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <Stack gap="xs">
        <MentionTextarea
          aria-label={t('comments.composer.bodyLabel')}
          placeholder={t('comments.composer.bodyPlaceholder')}
          value={values.body}
          onChange={(body) => set({ body })}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
              event.preventDefault();
              submit();
            }
          }}
          autosize
          minRows={2}
          maxRows={12}
          autoFocus={autoFocus}
        />
        <ImageThumbnailGrid images={thumbnails} size={72} onRemove={removeThumbnail} />
        <Group gap="xs" align="flex-end" justify="space-between">
          <Group gap="xs" align="flex-end" style={{ flex: '1 1 240px', minWidth: 0 }}>
            <VisibilitySelect
              subject="comment"
              size="xs"
              aria-label={t('comments.composer.visibilityLabel')}
              value={values.visibility}
              onChange={(visibility) => set({ visibility })}
              w={240}
              maw="100%"
            />
            {values.visibility === 'selective' && (
              <MemberMultiSelect
                size="xs"
                aria-label={t('comments.composer.selectiveLabel')}
                placeholder={t('comments.composer.selectivePlaceholder')}
                members={members}
                excludeUserIds={[currentUserId]}
                value={values.selectiveUserIds}
                onChange={(selectiveUserIds) => set({ selectiveUserIds })}
                style={{ flex: 1, minWidth: 200 }}
              />
            )}
          </Group>
          <Group gap="xs">
            <ImageAttachButtons
              remaining={remaining}
              onAddFiles={(files) =>
                set({ newImages: [...values.newImages, ...files.map(pendingFromFile)] })
              }
              onAddUrl={(url) => set({ newImages: [...values.newImages, pendingFromUrl(url)] })}
            />
            {onCancel && (
              <Button size="xs" variant="subtle" color="gray" onClick={onCancel}>
                {t('common.cancel')}
              </Button>
            )}
            <Button
              type="submit"
              size="xs"
              loading={submitting}
              disabled={!canSubmit}
              rightSection={<PaperPlaneRightIcon size={14} />}
            >
              {submitLabel}
            </Button>
          </Group>
        </Group>
      </Stack>
    </form>
  );
}
