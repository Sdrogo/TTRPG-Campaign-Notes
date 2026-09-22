import { MultiSelect, Stack, TextInput } from '@mantine/core';
import { VisibilitySelect } from './VisibilitySelect';
import { MentionTextarea } from './mentions/MentionTextarea';
import type { DocumentFormValues } from '../types/document';
import type { Tag } from '../types/tag';

interface DocumentFieldsProps {
  values: DocumentFormValues;
  onChange: (values: DocumentFormValues) => void;
  tags: Tag[];
  autoFocus?: boolean;
}

// Controlled name/description/visibility/tag inputs for a Document.
export function DocumentFields({ values, onChange, tags, autoFocus }: DocumentFieldsProps) {
  const set = (patch: Partial<DocumentFormValues>) => onChange({ ...values, ...patch });

  return (
    <Stack gap="sm">
      <TextInput
        label="Nome"
        value={values.name}
        onChange={(event) => set({ name: event.currentTarget.value })}
        required
        autoFocus={autoFocus}
      />
      <MentionTextarea
        label="Descrizione"
        description="Scrivi # per collegare un altro Documento."
        value={values.description}
        onChange={(description) => set({ description })}
        minRows={3}
        autosize
      />
      <VisibilitySelect
        label="Visibilità"
        subject="document"
        value={values.visibility}
        onChange={(visibility) => set({ visibility })}
      />
      <MultiSelect
        label="Tag"
        data={tags.map((t) => ({ value: t.id, label: t.name }))}
        value={values.tagIds}
        onChange={(tagIds) => set({ tagIds })}
        searchable
      />
    </Stack>
  );
}
