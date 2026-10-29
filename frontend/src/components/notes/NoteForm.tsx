import { useId, useState } from 'react';
import { Box, Button, Group, Stack, Switch, Text, TextInput } from '@mantine/core';
import { useMediaQuery } from '@mantine/hooks';
import { MemberMultiSelect } from '../MemberMultiSelect';
import { VisibilitySelect } from '../VisibilitySelect';
import { MarkdownEditor } from '../mentions/MarkdownEditor';
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
 * Title, description (with the same `#` mentions as a Document's), visibility,
 * at the Selective level who else may read a Note, and whether it is a
 * Relational link whose mentions draw the mention map (spec 41). Mounted
 * fresh each time editing starts, so "cancel" is just unmounting it.
 * Visibility and the Relational link switch share one row; on a phone the
 * switch's hint moves under the row so the select keeps its width.
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
  const phone = useMediaQuery('(max-width: 48em)', false, { getInitialValueInEffect: false });
  const hintId = useId();
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
      <Stack gap={phone ? 'xs' : 'sm'}>
        <TextInput
          spellCheck
          label={t('notes.form.title')}
          value={values.title}
          onChange={(event) => set({ title: event.currentTarget.value })}
          maxLength={MAX_NOTE_TITLE_LENGTH}
          required
          autoFocus
        />
        <MarkdownEditor
          label={t('common.description')}
          description={t('documents.fields.descriptionHint')}
          value={values.description}
          onChange={(description) => set({ description })}
          minRows={3}
          autosize
        />
        <Box>
          <Group align="flex-start" wrap="nowrap" gap={phone ? 'sm' : 'lg'}>
            <VisibilitySelect
              label={t('visibility.label')}
              subject="document"
              value={values.visibility}
              onChange={(visibility) => set({ visibility })}
              style={{ flex: 1, minWidth: 0 }}
            />
            {/* Skips the select's label so the switch sits level with its input. */}
            <Switch
              mt="calc(var(--mantine-font-size-sm) * var(--mantine-line-height) + 0.5rem)"
              label={t('notes.form.relationalLink')}
              description={phone ? undefined : t('notes.form.relationalLinkHint')}
              aria-describedby={phone ? hintId : undefined}
              checked={values.relationalLink}
              onChange={(event) => set({ relationalLink: event.currentTarget.checked })}
              style={{ flex: phone ? '0 0 auto' : 1 }}
            />
          </Group>
          {phone && (
            <Text id={hintId} size="xs" c="dimmed" mt={4}>
              {t('notes.form.relationalLinkHint')}
            </Text>
          )}
        </Box>
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
