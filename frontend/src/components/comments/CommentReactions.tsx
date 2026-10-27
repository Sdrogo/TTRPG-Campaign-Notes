import { useState } from 'react';
import { Button, Group, Popover, Tooltip } from '@mantine/core';
import { SmileyIcon } from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';
import { EmojiPicker } from './EmojiPicker';
import { findMember, memberDisplayName } from '../../lib/members';
import type { Reaction } from '../../types/comment';
import type { Member } from '../../types/member';
import { LabeledActionIcon } from '../LabeledActionIcon';

/** Different emoji a Comment can carry (spec 19c Decision 1); the backend enforces it too. */
export const MAX_REACTION_EMOJI = 20;

interface ReactionChipsProps {
  reactions: Reaction[];
  members: Member[];
  /** Adds (`add`) or takes back the viewer's reaction with this emoji. */
  onToggle: (emoji: string, add: boolean) => void;
  disabled: boolean;
  /** `lg` on Session 0 post-its (spec 46d Decision 6): bigger emoji and count. */
  size?: 'sm' | 'lg';
}

/**
 * The emoji already on a Comment, one chip each with its count. A click joins
 * or leaves it; hovering, focusing or a long press lists who reacted.
 */
export function ReactionChips({ reactions, members, onToggle, disabled, size = 'sm' }: ReactionChipsProps) {
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
              size={size === 'lg' ? 'compact-sm' : 'compact-xs'}
              className={size === 'lg' ? 'reaction-chip-lg' : undefined}
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
              {size === 'lg' ? (
                <>
                  <span className="reaction-emoji-lg">{reaction.emoji}</span>
                  {reaction.count}
                </>
              ) : (
                `${reaction.emoji} ${reaction.count}`
              )}
            </Button>
          </Tooltip>
        );
      })}
    </Group>
  );
}

interface AddReactionProps {
  /** The reactions already there: a Comment's, or a Session 0 post-it's (spec 46). */
  reactions: Reaction[];
  onToggle: (emoji: string, add: boolean) => void;
  disabled: boolean;
  /** `lg` on Session 0 post-its (spec 46d Decision 6). */
  size?: 'sm' | 'lg';
}

/**
 * Opens the emoji picker to react to a Comment or a post-it. Hidden once it
 * carries `MAX_REACTION_EMOJI` different emoji: the chips can still be joined.
 * Picking an emoji the viewer already used changes nothing.
 */
export function AddReaction({ reactions, onToggle, disabled, size = 'sm' }: AddReactionProps) {
  const { t } = useTranslation();
  const [opened, setOpened] = useState(false);
  if (reactions.length >= MAX_REACTION_EMOJI) {
    return null;
  }
  return (
    <Popover opened={opened} onChange={setOpened} position="bottom-start" shadow="md">
      <Popover.Target>
        <LabeledActionIcon
          variant="subtle"
          color="gray"
          size={size === 'lg' ? 'md' : 'sm'}
          aria-label={t('comments.reactions.add')}
          disabled={disabled}
          onClick={() => setOpened((current) => !current)}
        >
          <SmileyIcon size={size === 'lg' ? 20 : 16} />
        </LabeledActionIcon>
      </Popover.Target>
      <Popover.Dropdown p={0}>
        {opened && (
          <EmojiPicker
            onSelect={(emoji) => {
              setOpened(false);
              const existing = reactions.find((reaction) => reaction.emoji === emoji);
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
