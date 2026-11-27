import { useState } from 'react';
import { Button, Group, MultiSelect, Stack, Switch, TagsInput, Text, TextInput } from '@mantine/core';
import { useTranslation } from 'react-i18next';
import { MemberMultiSelect } from '../MemberMultiSelect';
import { VisibilitySelect } from '../VisibilitySelect';
import { MarkdownEditor } from '../mentions/MarkdownEditor';
import {
  MAX_ALIASES,
  MAX_RELATED_DOCUMENTS,
  MAX_TERM_LENGTH,
  canSubmitGlossary,
} from '../../lib/glossary';
import type { Document } from '../../types/document';
import type { GlossaryFormValues } from '../../types/glossary';
import type { Member } from '../../types/member';
import type { Tag } from '../../types/tag';

interface GlossaryEntryFormProps {
  initialValues: GlossaryFormValues;
  members: Member[];
  tags: Tag[];
  documents: Document[];
  submitLabel: string;
  onSubmit: (values: GlossaryFormValues) => void;
  submitting: boolean;
  /** The backend's refusal (a word already defined, a limit), shown above the buttons. */
  error?: string | null;
  onCancel: () => void;
}

/**
 * Term, aliases, definition (Markdown with the usual `#` mentions), Tags,
 * linked Documents, visibility, who else may read a Selective entry and
 * whether the term is highlighted in texts (spec 79). Mounted fresh each time
 * editing starts, so "cancel" is just unmounting it.
 */
export function GlossaryEntryForm({
  initialValues,
  members,
  tags,
  documents,
  submitLabel,
  onSubmit,
  submitting,
  error,
  onCancel,
}: GlossaryEntryFormProps) {
  const { t } = useTranslation();
  const [values, setValues] = useState(initialValues);
  const set = (patch: Partial<GlossaryFormValues>) =>
    setValues((current) => ({ ...current, ...patch }));

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        if (canSubmitGlossary(values)) onSubmit(values);
      }}
    >
      <Stack gap="sm">
        <TextInput
          spellCheck
          label={t('glossary.form.term')}
          value={values.term}
          onChange={(event) => set({ term: event.currentTarget.value })}
          maxLength={MAX_TERM_LENGTH}
          required
          autoFocus
        />
        <TagsInput
          label={t('glossary.form.aliases')}
          description={t('glossary.form.aliasesHint')}
          value={values.aliases}
          onChange={(aliases) => set({ aliases: aliases.slice(0, MAX_ALIASES) })}
          maxTags={MAX_ALIASES}
          splitChars={[',']}
        />
        <MarkdownEditor
          label={t('glossary.form.definition')}
          description={t('documents.fields.descriptionHint')}
          value={values.definition}
          onChange={(definition) => set({ definition })}
          minRows={4}
          autosize
        />
        <MultiSelect
          label={t('glossary.form.tags')}
          data={tags.map((tag) => ({ value: tag.id, label: `#${tag.name}` }))}
          value={values.tagIds}
          onChange={(tagIds) => set({ tagIds })}
          searchable
          clearable
        />
        <MultiSelect
          label={t('glossary.form.documents')}
          data={documents.map((document) => ({ value: document.id, label: document.name }))}
          value={values.documentIds}
          onChange={(documentIds) => set({ documentIds: documentIds.slice(0, MAX_RELATED_DOCUMENTS) })}
          maxValues={MAX_RELATED_DOCUMENTS}
          searchable
          clearable
        />
        <VisibilitySelect
          label={t('visibility.label')}
          subject="glossary"
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
        <Switch
          label={t('glossary.form.highlight')}
          description={t('glossary.form.highlightHint')}
          checked={values.highlight}
          onChange={(event) => set({ highlight: event.currentTarget.checked })}
        />
        {error && (
          <Text c="red" size="sm" role="alert">
            {error}
          </Text>
        )}
        <Group>
          <Button type="submit" loading={submitting} disabled={!canSubmitGlossary(values)}>
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
