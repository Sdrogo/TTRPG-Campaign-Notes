import { MultiSelect, Stack, TextInput } from '@mantine/core';
import { VisibilitySelect } from './VisibilitySelect';
import { MentionTextarea } from './mentions/MentionTextarea';
import { TagCreateInline } from './TagCreateInline';
import type { DocumentFormValues } from '../types/document';
import type { Tag } from '../types/tag';
import { useTranslation } from 'react-i18next';

interface DocumentFieldsProps {
  values: DocumentFormValues;
  /** Accepts a functional update too (like `useState`'s setter, which both
   *  callers pass directly) - `onCreated` below relies on that form so a
   *  Tag created while the user keeps typing doesn't clobber those edits
   *  with the stale `values` this component was last rendered with. */
  onChange: (update: DocumentFormValues | ((previous: DocumentFormValues) => DocumentFormValues)) => void;
  tags: Tag[];
  roomId: string;
  /** Whether the viewer may create a Tag here (Administrator or Master,
   *  `POST /rooms/{id}/tags`) - spec 10 extends this to edit mode. */
  canCreateTag: boolean;
  onTagCreatePendingChange?: (pending: boolean) => void;
  autoFocus?: boolean;
}

/** Controlled name/description/visibility/tag inputs for a Document. */
export function DocumentFields({
  values,
  onChange,
  tags,
  roomId,
  canCreateTag,
  onTagCreatePendingChange,
  autoFocus,
}: DocumentFieldsProps) {
  const { t } = useTranslation();
  const set = (patch: Partial<DocumentFormValues>) => onChange({ ...values, ...patch });

  return (
    <Stack gap="sm">
      <TextInput
        label={t('common.name')}
        value={values.name}
        onChange={(event) => set({ name: event.currentTarget.value })}
        required
        autoFocus={autoFocus}
      />
      <MentionTextarea
        label={t('common.description')}
        description={t('documents.fields.descriptionHint')}
        value={values.description}
        onChange={(description) => set({ description })}
        minRows={3}
        autosize
      />
      <VisibilitySelect
        label={t('visibility.label')}
        subject="document"
        value={values.visibility}
        onChange={(visibility) => set({ visibility })}
      />
      <MultiSelect
        label={t('documents.fields.tags')}
        data={tags.map((t) => ({ value: t.id, label: t.name }))}
        value={values.tagIds}
        onChange={(tagIds) => set({ tagIds })}
        searchable
      />
      {canCreateTag && (
        <TagCreateInline
          roomId={roomId}
          // Functional update: creation is async, so `values` here could be
          // stale by the time it resolves - appending to whatever the form
          // holds *then* keeps a Name/Description edit made while it was
          // pending instead of overwriting it with this render's snapshot.
          onCreated={(tag) =>
            onChange((previous) => ({ ...previous, tagIds: [...previous.tagIds, tag.id] }))
          }
          onPendingChange={onTagCreatePendingChange}
        />
      )}
    </Stack>
  );
}
