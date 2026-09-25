import { Box, Button, Group, Stack, Text } from '@mantine/core';
import { FilePlusIcon, FileTextIcon, TagIcon } from '@phosphor-icons/react';
import {
  mentionOptionId,
  mentionTargetId,
  mentionTargetName,
  type MentionKind,
  type MentionTarget,
} from '../../lib/documentMentions';
import { useTranslation } from 'react-i18next';

interface MentionSuggestionsProps {
  listId: string;
  candidates: MentionTarget[];
  activeIndex: number;
  onHover: (index: number) => void;
  onPick: (target: MentionTarget) => void;
  /**
   * Shown instead of the list when nothing matched and the viewer may create
   * something; null otherwise.
   */
  create: MentionCreateProps | null;
}

/**
 * The popup's content: the matching Documents and Tags, or (when nothing
 * matched) a way to create one.
 */
export function MentionSuggestions({ listId, candidates, activeIndex, onHover, onPick, create }: MentionSuggestionsProps) {
  const { t } = useTranslation();
  if (candidates.length === 0 && !create) {
    return (
      <Text size="sm" c="dimmed" px="xs" py={6}>
        {t('common.noResults')}
      </Text>
    );
  }

  return (
    <Box id={listId} role="listbox" aria-label={t('mentions.listLabel')}>
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
  const { t } = useTranslation();
  const Icon = target.kind === 'document' ? FileTextIcon : TagIcon;
  const detail =
    target.kind === 'document'
      ? target.tags.map((tag) => `#${tag.name}`).join(' ')
      : t('mentions.tagDetail', { count: target.documentCount });

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

/**
 * The "create" row shown when nothing matched: the typed name, which kinds the
 * viewer may create, and the one currently chosen.
 */
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
  const { t } = useTranslation();
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
          {t('mentions.noMatchCreate', { name })}
        </Text>
        <Group gap="xs" justify="space-between" wrap="wrap">
          {kinds.length > 1 ? (
            // Plain buttons, not a SegmentedControl: its radio inputs take
            // the focus on click, which would close the popup.
            <Button.Group aria-label={t('mentions.kindSwitchLabel')}>
              {kinds.map((value) => (
                <Button
                  key={value}
                  size="xs"
                  variant={value === kind ? 'light' : 'default'}
                  aria-pressed={value === kind}
                  onClick={() => onKindChange(value)}
                >
                  {t(`mentions.kind.${value}`)}
                </Button>
              ))}
            </Button.Group>
          ) : (
            <Text size="xs" fw={600}>
              {t(`mentions.kind.${kind}`)}
            </Text>
          )}
          <Button
            size="xs"
            variant={highlighted ? 'filled' : 'light'}
            leftSection={kind === 'document' ? <FilePlusIcon size={14} /> : <TagIcon size={14} />}
            loading={creating}
            onClick={onCreate}
          >
            {t('mentions.createKind', { kind: t(`mentions.kind.${kind}`) })}
          </Button>
        </Group>
        {highlighted && (
          <Text size="xs" c="dimmed">
            {kinds.length > 1 ? t('mentions.hintSwitchKind') : ''}
            {t('mentions.hintCreate')}
          </Text>
        )}
      </Stack>
    </Box>
  );
}
