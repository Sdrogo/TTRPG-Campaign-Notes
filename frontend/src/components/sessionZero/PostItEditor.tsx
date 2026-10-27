import { useState } from 'react';
import { Button, Group, Stack, Text, Textarea } from '@mantine/core';
import { useTranslation } from 'react-i18next';
import { MAX_POST_IT_LENGTH } from '../../lib/sessionZero';

interface PostItEditorProps {
  initial?: string;
  submitLabel: string;
  busy: boolean;
  onSubmit: (body: string) => void;
  onCancel: () => void;
}

/**
 * A post-it's text, new or edited, with the characters left shown while
 * typing (spec 46 Decision 12). Empty text can't be saved.
 */
export function PostItEditor({ initial = '', submitLabel, busy, onSubmit, onCancel }: PostItEditorProps) {
  const { t } = useTranslation();
  const [body, setBody] = useState(initial);
  const left = MAX_POST_IT_LENGTH - body.length;
  return (
    <Stack gap={4}>
      <Textarea
        aria-label={t('sessionZero.postIt.text')}
        value={body}
        onChange={(event) => setBody(event.currentTarget.value)}
        maxLength={MAX_POST_IT_LENGTH}
        autosize
        minRows={2}
        maxRows={8}
        autoFocus
      />
      <Group justify="space-between" wrap="nowrap" gap="xs">
        <Text size="xs" c={left <= 20 ? 'var(--state-warning)' : 'dimmed'} aria-live="polite">
          {t('sessionZero.postIt.charactersLeft', { count: left })}
        </Text>
        <Group gap={4} wrap="nowrap">
          <Button size="compact-sm" variant="default" onClick={onCancel}>
            {t('common.cancel')}
          </Button>
          <Button size="compact-sm" disabled={!body.trim() || busy} onClick={() => onSubmit(body.trim())}>
            {submitLabel}
          </Button>
        </Group>
      </Group>
    </Stack>
  );
}
