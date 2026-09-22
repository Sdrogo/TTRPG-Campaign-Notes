import { Box, Button, Group, Stack, Text } from '@mantine/core';
import { FilePlusIcon, FileTextIcon, TagIcon } from '@phosphor-icons/react';
import {
  mentionOptionId,
  mentionTargetId,
  mentionTargetName,
  type MentionKind,
  type MentionTarget,
} from '../../lib/documentMentions';

const KIND_LABELS: Record<MentionKind, string> = { document: 'Documento', tag: 'Tag' };

interface MentionSuggestionsProps {
  listId: string;
  candidates: MentionTarget[];
  activeIndex: number;
  onHover: (index: number) => void;
  onPick: (target: MentionTarget) => void;
  // Shown instead of the list when nothing matched and the viewer may
  // create something; null otherwise.
  create: MentionCreateProps | null;
}

// The popup's content: the matching Documents and Tags, or (when nothing
// matched) a way to create one.
export function MentionSuggestions({ listId, candidates, activeIndex, onHover, onPick, create }: MentionSuggestionsProps) {
  if (candidates.length === 0 && !create) {
    return (
      <Text size="sm" c="dimmed" px="xs" py={6}>
        Nessun risultato
      </Text>
    );
  }

  return (
    <Box id={listId} role="listbox" aria-label="Documenti e Tag da collegare">
      {candidates.map((target, index) => (
        <MentionOption
          key={`${target.kind}-${mentionTargetId(target)}`}
          id={mentionOptionId(listId, index)}
          target={target}
          active={index === activeIndex}
          onHover={() => onHover(index)}
          onPick={() => onPick(target)}
        />
      ))}
      {candidates.length === 0 && create && <MentionCreateRow id={mentionOptionId(listId, 'create')} {...create} />}
    </Box>
  );
}

interface MentionOptionProps {
  id: string;
  target: MentionTarget;
  active: boolean;
  onHover: () => void;
  onPick: () => void;
}

function MentionOption({ id, target, active, onHover, onPick }: MentionOptionProps) {
  const Icon = target.kind === 'document' ? FileTextIcon : TagIcon;
  const detail =
    target.kind === 'document'
      ? target.tags.map((tag) => `#${tag.name}`).join(' ')
      : `Tag · ${target.documentCount} ${target.documentCount === 1 ? 'Documento' : 'Documenti'}`;

  return (
    <Box
      id={id}
      role="option"
      aria-selected={active}
      data-active={active || undefined}
      data-kind={target.kind}
      className="mention-option"
      onMouseEnter={onHover}
      onClick={onPick}
    >
      <Icon size={16} color="var(--text-muted)" style={{ flexShrink: 0, marginTop: 2 }} />
      <Box style={{ minWidth: 0 }}>
        <Text size="sm" style={{ overflowWrap: 'anywhere' }}>
          {mentionTargetName(target)}
        </Text>
        {detail && (
          <Text size="xs" c="dimmed" truncate>
            {detail}
          </Text>
        )}
      </Box>
    </Box>
  );
}

export interface MentionCreateProps {
  name: string;
  kinds: MentionKind[];
  kind: MentionKind;
  onKindChange: (kind: MentionKind) => void;
  highlighted: boolean;
  creating: boolean;
  onCreate: () => void;
}

// "Nothing found": create the typed name as a new blank Document or a Tag,
// with a switch when the viewer may create both.
function MentionCreateRow({ id, name, kinds, kind, onKindChange, highlighted, creating, onCreate }: MentionCreateProps & { id: string }) {
  return (
    <Box
      id={id}
      role="option"
      aria-selected={highlighted}
      data-active={highlighted || undefined}
      className="mention-option mention-create"
    >
      <Stack gap={6} style={{ flex: 1, minWidth: 0 }}>
        <Text size="xs" c="dimmed" style={{ overflowWrap: 'anywhere' }}>
          Nessun risultato per «{name}». Crealo come:
        </Text>
        <Group gap="xs" justify="space-between" wrap="wrap">
          {kinds.length > 1 ? (
            // Plain buttons, not a SegmentedControl: its radio inputs take
            // the focus on click, which would close the popup.
            <Button.Group aria-label="Tipo del nuovo elemento">
              {kinds.map((value) => (
                <Button
                  key={value}
                  size="xs"
                  variant={value === kind ? 'light' : 'default'}
                  aria-pressed={value === kind}
                  onClick={() => onKindChange(value)}
                >
                  {KIND_LABELS[value]}
                </Button>
              ))}
            </Button.Group>
          ) : (
            <Text size="xs" fw={600}>
              {KIND_LABELS[kind]}
            </Text>
          )}
          <Button
            size="xs"
            variant={highlighted ? 'filled' : 'light'}
            leftSection={kind === 'document' ? <FilePlusIcon size={14} /> : <TagIcon size={14} />}
            loading={creating}
            onClick={onCreate}
          >
            Crea {KIND_LABELS[kind]}
          </Button>
        </Group>
        {highlighted && (
          <Text size="xs" c="dimmed">
            {kinds.length > 1 ? '←/→ cambia tipo · ' : ''}Invio per creare
          </Text>
        )}
      </Stack>
    </Box>
  );
}
