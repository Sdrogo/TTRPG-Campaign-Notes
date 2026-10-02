import { useState } from 'react';
import { ActionIcon, Button, Group, Popover, Tooltip } from '@mantine/core';
import { SmileyIcon } from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';
import { EmojiPicker } from './EmojiPicker';
import { findMember, memberDisplayName } from '../../lib/members';
import type { Comment, Reaction } from '../../types/comment';
import type { Member } from '../../types/member';

/** Different emoji a Comment can carry (spec 19c Decision 1); the backend enforces it too. */
export const MAX_REACTION_EMOJI = 20;

interface ReactionChipsProps {
  reactions: Reaction[];
  members: Member[];
  /** Adds (`add`) or takes back the viewer's reaction with this emoji. */
  onToggle: (emoji: string, add: boolean) => void;
  disabled: boolean;
}

/**
 * The emoji already on a Comment, one chip each with its count. A click joins
 * or leaves it; hovering, focusing or a long press lists who reacted.
 */
export function ReactionChips({ reactions, members, onToggle, disabled }: ReactionChipsProps) {
  const { t } = useTranslation();
  if (reactions.length === 0) {
    return null;
  }
  return (
    <Group gap={6} pl="xs">
      {reactions.map((reaction) => {
        const names = reaction.userIds
          .map((id) => memberDisplayName(findMember(members, id)))
          .join(', ');
        return (
          <Tooltip
            key={reaction.emoji}
            label={names}
            events={{ hover: true, focus: true, touch: true }}
            multiline
            maw={240}
            withArrow
          >
            <Button
              size="compact-xs"
              radius="xl"
              variant={reaction.reactedByMe ? 'light' : 'default'}
              aria-pressed={reaction.reactedByMe}
              aria-label={t('comments.reactions.chip', {
                emoji: reaction.emoji,
                count: reaction.count,
                names,
              })}
              disabled={disabled}
              onClick={() => onToggle(reaction.emoji, !reaction.reactedByMe)}
            >
              {reaction.emoji} {reaction.count}
            </Button>
          </Tooltip>
        );
      })}
    </Group>
  );
}

interface AddReactionProps {
  comment: Comment;
  onToggle: (emoji: string, add: boolean) => void;
  disabled: boolean;
}

/**
 * Opens the emoji picker to react to a Comment. Hidden once the Comment
 * carries `MAX_REACTION_EMOJI` different emoji: the chips can still be joined.
 * Picking an emoji the viewer already used changes nothing.
 */
export function AddReaction({ comment, onToggle, disabled }: AddReactionProps) {
  const { t } = useTranslation();
  const [opened, setOpened] = useState(false);
  if (comment.reactions.length >= MAX_REACTION_EMOJI) {
    return null;
  }
  return (
    <Popover opened={opened} onChange={setOpened} position="bottom-start" shadow="md">
      <Popover.Target>
        <ActionIcon
          variant="subtle"
          color="gray"
          size="sm"
          aria-label={t('comments.reactions.add')}
          disabled={disabled}
          onClick={() => setOpened((current) => !current)}
        >
          <SmileyIcon size={16} />
        </ActionIcon>
      </Popover.Target>
      <Popover.Dropdown p={0}>
        {opened && (
          <EmojiPicker
            onSelect={(emoji) => {
              setOpened(false);
              const existing = comment.reactions.find((reaction) => reaction.emoji === emoji);
              if (!existing?.reactedByMe) {
                onToggle(emoji, true);
              }
            }}
          />
        )}
      </Popover.Dropdown>
    </Popover>
  );
}
