import { useState } from 'react';
import { Alert, Badge, Button, Checkbox, Group, Loader, Modal, ScrollArea, Stack, Text } from '@mantine/core';
import { useTranslation } from 'react-i18next';
import { ApiError } from '../../lib/apiClient';
import { notifyError, notifySuccess } from '../../lib/notify';
import { useApplyMentionSuggestions, useMentionSuggestions } from '../../hooks/useMentionSuggestions';
import type { MentionSuggestion, MentionSuggestionSource } from '../../types/mentionSuggestion';

interface GenerateMentionsModalProps {
  roomId: string;
  /** The Document to scan, or null for every Document of the Room the viewer manages. */
  documentId: string | null;
  onClose: () => void;
}

function sourceKey(source: MentionSuggestionSource): string {
  return `${source.documentId}:${source.noteId ?? ''}`;
}

function matchKey(source: MentionSuggestionSource, match: MentionSuggestion): string {
  return `${sourceKey(source)}:${match.start}`;
}

/**
 * The "Genera menzioni" dialog (spec 39 Decisions 1, 2 and 7): every place the
 * name of a Document the viewer sees (never a Tag) appears as plain words in the
 * texts they manage, each checked by default with its own checkbox and one
 * per text, then "Applica" writes the checked ones as mentions. Mounted only
 * while open, so each opening reads the proposals afresh.
 */
export function GenerateMentionsModal({ roomId, documentId, onClose }: GenerateMentionsModalProps) {
  const { t } = useTranslation();
  const suggestions = useMentionSuggestions(roomId, documentId);
  const apply = useApplyMentionSuggestions(roomId);
  // Opt-out (Decision 2): what is not in here is applied.
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const sources = suggestions.data ?? [];
  const chosen = sources
    .map((source) => ({
      documentId: source.documentId,
      noteId: source.noteId,
      matches: source.matches.filter((match) => !excluded.has(matchKey(source, match))),
    }))
    .filter((source) => source.matches.length > 0);
  const chosenCount = chosen.reduce((total, source) => total + source.matches.length, 0);

  const toggle = (keys: string[], checked: boolean) =>
    setExcluded((current) => {
      const next = new Set(current);
      for (const key of keys) {
        if (checked) next.delete(key);
        else next.add(key);
      }
      return next;
    });

  const handleApply = () =>
    apply.mutate(chosen, {
      onSuccess: (result) => {
        notifySuccess(t('mentionSuggestions.applied', { count: result.applied }));
        onClose();
      },
      onError: (error) => {
        notifyError(error);
        // Decision 7: a text changed since the preview, so show the current one.
        if (error instanceof ApiError && error.status === 409) {
          setExcluded(new Set());
          void suggestions.refetch();
        }
      },
    });

  return (
    <Modal opened onClose={onClose} title={t('mentionSuggestions.title')} size="lg" centered>
      <Stack gap="md">
        <Text size="sm">
          {documentId ? t('mentionSuggestions.introDocument') : t('mentionSuggestions.introRoom')}
        </Text>
        {suggestions.isPending ? (
          <Group justify="center" py="md">
            <Loader size="sm" aria-label={t('mentionSuggestions.loading')} />
          </Group>
        ) : suggestions.isError ? (
          <Alert color="red">{suggestions.error.message}</Alert>
        ) : sources.length === 0 ? (
          <Text c="dimmed">{t('mentionSuggestions.empty')}</Text>
        ) : (
          <ScrollArea.Autosize mah="60vh" offsetScrollbars>
            <Stack gap="md">
              {sources.map((source) => (
                <SourceGroup
                  key={sourceKey(source)}
                  source={source}
                  showDocument={documentId === null}
                  excluded={excluded}
                  onToggle={toggle}
                />
              ))}
            </Stack>
          </ScrollArea.Autosize>
        )}
        <Group justify="space-between">
          <Text size="sm" c="dimmed">
            {sources.length > 0 && t('mentionSuggestions.selected', { count: chosenCount })}
          </Text>
          <Group gap="xs">
            <Button variant="subtle" color="gray" onClick={onClose}>
              {t('common.cancel')}
            </Button>
            <Button onClick={handleApply} loading={apply.isPending} disabled={chosenCount === 0}>
              {t('mentionSuggestions.apply')}
            </Button>
          </Group>
        </Group>
      </Stack>
    </Modal>
  );
}

/** One text's proposals: a checkbox for all of them, then one per match. */
function SourceGroup({
  source,
  showDocument,
  excluded,
  onToggle,
}: {
  source: MentionSuggestionSource;
  /** On the Room's dialog every text names its Document too. */
  showDocument: boolean;
  excluded: Set<string>;
  onToggle: (keys: string[], checked: boolean) => void;
}) {
  const { t } = useTranslation();
  const keys = source.matches.map((match) => matchKey(source, match));
  const kept = keys.filter((key) => !excluded.has(key)).length;
  const where =
    source.noteId === null
      ? t('mentionSuggestions.description')
      : t('mentionSuggestions.note', { title: source.noteTitle });
  const label = showDocument
    ? t('mentionSuggestions.inDocument', { document: source.documentName, where })
    : where;

  return (
    <Stack gap={6}>
      <Checkbox
        label={<Text fw={600}>{label}</Text>}
        checked={kept === keys.length}
        indeterminate={kept > 0 && kept < keys.length}
        onChange={(event) => onToggle(keys, event.currentTarget.checked)}
      />
      <Stack gap={4} pl="lg">
        {source.matches.map((match, index) => (
          <Checkbox
            key={keys[index]}
            checked={!excluded.has(keys[index])}
            onChange={(event) => onToggle([keys[index]], event.currentTarget.checked)}
            aria-label={t('mentionSuggestions.matchLabel', { text: match.text, name: match.targetName })}
            label={
              <Group gap={6} wrap="nowrap" align="flex-start">
                <Text size="sm" style={{ overflowWrap: 'anywhere' }}>
                  {match.before}
                  <Text span fw={700} c="var(--mantine-primary-color-filled)">
                    {match.text}
                  </Text>
                  {match.after}
                </Text>
                <Badge variant="light" color="gray" style={{ flexShrink: 0 }}>
                  {t('mentionSuggestions.target', {
                    kind: match.kind === 'doc' ? t('mentions.kind.document') : t('mentions.kind.tag'),
                    name: match.targetName,
                  })}
                </Badge>
              </Group>
            }
          />
        ))}
      </Stack>
    </Stack>
  );
}
