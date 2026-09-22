import { useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import { Box, Popover, Text, Textarea, type TextareaProps } from '@mantine/core';
import { FileTextIcon } from '@phosphor-icons/react';
import { useDocumentMentions } from '../../hooks/useDocumentMentions';
import {
  filterMentionCandidates,
  findMentionQuery,
  insertMention,
  mentionKeyAction,
  moveActiveIndex,
  type MentionCandidate,
} from '../../lib/documentMentions';

interface MentionTextareaProps extends Omit<TextareaProps, 'value' | 'onChange'> {
  value: string;
  onChange: (value: string) => void;
}

// A `Textarea` that suggests the Room's Documents when a word starts with
// `#` (arrows + Enter/Tab, or a click, to pick one; Esc to dismiss). Works
// as a plain textarea outside a `DocumentMentionsProvider`.
export function MentionTextarea({ value, onChange, onKeyDown, onBlur, ...props }: MentionTextareaProps) {
  const mentions = useDocumentMentions();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const pendingCaret = useRef<number | null>(null);
  const listId = useId();
  const [caret, setCaret] = useState<number | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  // `start:query` of a suggestion list the user closed (Esc or a pick); it
  // opens again as soon as the query changes.
  const [dismissed, setDismissed] = useState<string | null>(null);

  const mention = mentions && caret !== null ? findMentionQuery(value, caret) : null;
  const mentionKey = mention ? `${mention.start}:${mention.query}` : null;
  // Cheap enough (a Room's Documents) to redo on every render.
  const candidates =
    mention && mentions ? filterMentionCandidates(mentions.documents, mentions.tags, mention.query) : [];
  // Names can have spaces, so the list stays open past a space while
  // something still matches.
  const opened =
    mention !== null &&
    mentionKey !== dismissed &&
    (candidates.length > 0 || !/\s/.test(mention.query));
  const active = Math.min(activeIndex, Math.max(candidates.length - 1, 0));

  // Put the caret right after an inserted mention, once React has rendered
  // the new value.
  useLayoutEffect(() => {
    const textarea = textareaRef.current;
    if (textarea && pendingCaret.current !== null) {
      textarea.focus();
      textarea.setSelectionRange(pendingCaret.current, pendingCaret.current);
      pendingCaret.current = null;
    }
  }, [value]);

  const trackCaret = (textarea: HTMLTextAreaElement) => {
    const next = textarea.selectionStart === textarea.selectionEnd ? textarea.selectionStart : null;
    if (next !== caret) {
      setCaret(next);
      setActiveIndex(0);
    }
  };

  const select = (candidate: MentionCandidate) => {
    if (!mention || caret === null) {
      return;
    }
    const result = insertMention(value, mention, caret, candidate.document.name);
    pendingCaret.current = result.caret;
    setCaret(result.caret);
    setDismissed(`${mention.start}:${result.text.slice(mention.start + 1, result.caret)}`);
    onChange(result.text);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    const action = opened ? mentionKeyAction(event) : null;
    // Enter/Tab with nothing to pick behave as usual.
    if (action && !(action === 'select' && candidates.length === 0)) {
      event.preventDefault();
      if (action === 'next' || action === 'previous') {
        setActiveIndex(moveActiveIndex(active, candidates.length, action === 'next' ? 1 : -1));
      } else if (action === 'select') {
        select(candidates[active]);
      } else {
        setDismissed(mentionKey);
      }
      return;
    }
    onKeyDown?.(event);
  };

  const activeOptionId = opened && candidates.length > 0 ? `${listId}-${active}` : undefined;

  return (
    <Popover
      opened={opened}
      position="bottom-start"
      width="target"
      shadow="md"
      trapFocus={false}
      returnFocus={false}
      closeOnEscape={false}
      // Like Mantine's Combobox: suggestions appear and update instantly.
      transitionProps={{ duration: 0 }}
    >
      <Popover.Target>
        <Box>
          <Textarea
            {...props}
            ref={textareaRef}
            value={value}
            onChange={(event) => {
              onChange(event.currentTarget.value);
              trackCaret(event.currentTarget);
            }}
            onSelect={(event) => trackCaret(event.currentTarget)}
            onKeyDown={handleKeyDown}
            onBlur={(event) => {
              setCaret(null);
              onBlur?.(event);
            }}
            role={mentions ? 'combobox' : undefined}
            aria-autocomplete={mentions ? 'list' : undefined}
            aria-expanded={mentions ? opened : undefined}
            aria-controls={activeOptionId ? listId : undefined}
            aria-activedescendant={activeOptionId}
          />
        </Box>
      </Popover.Target>
      <Popover.Dropdown p={4}>
        {candidates.length === 0 ? (
          <Text size="sm" c="dimmed" px="xs" py={6}>
            Nessun Documento trovato
          </Text>
        ) : (
          <Box id={listId} role="listbox" aria-label="Documenti da collegare">
            {candidates.map((candidate, index) => (
              <MentionOption
                key={candidate.document.id}
                id={`${listId}-${index}`}
                candidate={candidate}
                active={index === active}
                onHover={() => setActiveIndex(index)}
                onPick={() => select(candidate)}
              />
            ))}
          </Box>
        )}
      </Popover.Dropdown>
    </Popover>
  );
}

interface MentionOptionProps {
  id: string;
  candidate: MentionCandidate;
  active: boolean;
  onHover: () => void;
  onPick: () => void;
}

function MentionOption({ id, candidate, active, onHover, onPick }: MentionOptionProps) {
  return (
    <Box
      id={id}
      role="option"
      aria-selected={active}
      data-active={active || undefined}
      className="mention-option"
      // Keep the focus (and caret) in the textarea.
      onMouseDown={(event) => event.preventDefault()}
      onMouseEnter={onHover}
      onClick={onPick}
    >
      <FileTextIcon size={16} color="var(--text-muted)" style={{ flexShrink: 0, marginTop: 2 }} />
      <Box style={{ minWidth: 0 }}>
        <Text size="sm" style={{ overflowWrap: 'anywhere' }}>
          {candidate.document.name}
        </Text>
        {candidate.tags.length > 0 && (
          <Text size="xs" c="dimmed" truncate>
            {candidate.tags.map((tag) => `#${tag.name}`).join(' ')}
          </Text>
        )}
      </Box>
    </Box>
  );
}
