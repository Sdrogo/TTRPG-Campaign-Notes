import { useState } from 'react';
import { Button, Group, Stack, TextInput } from '@mantine/core';
import { MemberMultiSelect } from '../MemberMultiSelect';
import { VisibilitySelect } from '../VisibilitySelect';
import { MentionTextarea } from '../mentions/MentionTextarea';
import { MAX_NOTE_TITLE_LENGTH, canSubmitNote } from '../../lib/notes';
import type { Member } from '../../types/member';
import type { NoteFormValues } from '../../types/note';
import { useTranslation } from 'react-i18next';

interface NoteFormProps {
  initialValues: NoteFormValues;
  members: Member[];
  submitLabel: string;
  onSubmit: (values: NoteFormValues) => void;
  submitting: boolean;
  onCancel: () => void;
}

/**
 * Title, description (with the same `#` mentions as a Document's), visibility
 * and, at the Selective level, who else may read a Note. Mounted fresh each
 * time editing starts, so "cancel" is just unmounting it.
 */
export function NoteForm({
  initialValues,
  members,
  submitLabel,
  onSubmit,
  submitting,
  onCancel,
}: NoteFormProps) {
  const { t } = useTranslation();
  const [values, setValues] = useState(initialValues);
  const set = (patch: Partial<NoteFormValues>) => setValues((current) => ({ ...current, ...patch }));

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        if (canSubmitNote(values)) {
          onSubmit(values);
        }
      }}
    >
      <Stack gap="sm">
        <TextInput
          label={t('notes.form.title')}
          value={values.title}
          onChange={(event) => set({ title: event.currentTarget.value })}
          maxLength={MAX_NOTE_TITLE_LENGTH}
          required
          autoFocus
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
        {values.visibility === 'selective' && (
          <MemberMultiSelect
            label={t('notes.form.selectiveLabel')}
            placeholder={t('notes.form.selectivePlaceholder')}
            members={members}
            value={values.selectiveUserIds}
            onChange={(selectiveUserIds) => set({ selectiveUserIds })}
          />
        )}
        <Group>
          <Button type="submit" loading={submitting} disabled={!canSubmitNote(values)}>
            {submitLabel}
          </Button>
          <Button variant="subtle" color="gray" onClick={onCancel}>
            {t('common.cancel')}
          </Button>
        </Group>
      </Stack>
    </form>
  );
}
