import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import { Box, Popover, Textarea, type TextareaProps } from '@mantine/core';
import { useDocumentMentions } from '../../hooks/useDocumentMentions';
import { notifyError } from '../../lib/notify';
import {
  creatableKinds,
  filterMentionCandidates,
  findMentionQuery,
  insertMention,
  isFinishedMention,
  mentionKeyAction,
  mentionOptionId,
  mentionTargetName,
  moveActiveIndex,
  newEntryName,
  type MentionKind,
  type MentionQuery,
  type MentionTarget,
} from '../../lib/documentMentions';
import { MentionSuggestions } from './MentionSuggestions';

interface MentionTextareaProps extends Omit<TextareaProps, 'value' | 'onChange'> {
  value: string;
  onChange: (value: string) => void;
}

/**
 * A `Textarea` that suggests the Room's Documents and Tags when a word starts
 * with `#` (arrows + Enter/Tab, or a click, to pick one; Esc to dismiss). When
 * nothing matches, the typed name can be created as a blank Document or a Tag.
 * Works as a plain textarea outside a `DocumentMentionsProvider`.
 */
export function MentionTextarea({ value, onChange, onKeyDown, onBlur, ...props }: MentionTextareaProps) {
  const mentions = useDocumentMentions();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const pendingCaret = useRef<number | null>(null);
  // Latest value/onChange, for when a create request finishes later.
  const latest = useRef({ value, onChange });
  const listId = useId();
  const [caret, setCaret] = useState<number | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  // Start of a `#` whose popup was closed (Esc, or a pick). It stays closed
  // until the caret leaves that mention.
  const [dismissedStart, setDismissedStart] = useState<number | null>(null);
  const [createHighlighted, setCreateHighlighted] = useState(false);
  const [chosenKind, setChosenKind] = useState<MentionKind | null>(null);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    latest.current = { value, onChange };
  });

  const mention = mentions && caret !== null ? findMentionQuery(value, caret) : null;
  // Cheap enough (a Room's Documents and Tags) to redo on every render.
  const candidates =
    mention && mentions ? filterMentionCandidates(mentions.documents, mentions.tags, mention.query) : [];
  const finished =
    mention !== null &&
    mentions !== null &&
    isFinishedMention(mention.query, [
      ...mentions.documents.map((document) => document.name),
      ...mentions.tags.map((tag) => tag.name),
    ]);
  const kinds = mentions ? creatableKinds(mentions) : [];
  const kind = chosenKind !== null && kinds.includes(chosenKind) ? chosenKind : kinds[0];
  const newName = mention ? newEntryName(mention.query) : '';
  const createAvailable = candidates.length === 0 && kind !== undefined && newName !== '';
  // Names can have spaces, so the popup stays open past a space while
  // something matches or can be created.
  const opened =
    mention !== null &&
    !finished &&
    mention.start !== dismissedStart &&
    (candidates.length > 0 || createAvailable || !/\s/.test(mention.query));
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
    if (next === caret) {
      return;
    }
    setCaret(next);
    setActiveIndex(0);
    setCreateHighlighted(false);
    const nextMention = next === null ? null : findMentionQuery(textarea.value, next);
    if (nextMention?.start !== dismissedStart) {
      setDismissedStart(null);
    }
  };

  // Writes `#Name` over the `#query` and closes the popup for it.
  const complete = (text: string, at: MentionQuery, queryEnd: number, target: MentionTarget) => {
    const result = insertMention(text, at, queryEnd, mentionTargetName(target));
    pendingCaret.current = result.caret;
    setCaret(result.caret);
    setDismissedStart(at.start);
    latest.current.onChange(result.text);
  };

  const pick = (target: MentionTarget) => {
    if (mention && caret !== null) {
      complete(value, mention, caret, target);
    }
  };

  const create = async () => {
    if (!mentions || !mention || !createAvailable || creating) {
      return;
    }
    const typed = `#${mention.query}`;
    setCreating(true);
    try {
      const created = await mentions.create(kind, newName);
      // Only replace what was typed if it's still there, unchanged.
      const text = latest.current.value;
      if (text.slice(mention.start, mention.start + typed.length) === typed) {
        complete(text, mention, mention.start + typed.length, created);
      }
    } catch (error) {
      notifyError(error);
    } finally {
      setCreating(false);
      setCreateHighlighted(false);
    }
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    const action = opened
      ? mentionKeyAction(event, {
          candidateCount: candidates.length,
          createAvailable,
          createHighlighted,
        })
      : null;
    if (!action) {
      onKeyDown?.(event);
      return;
    }
    event.preventDefault();
    switch (action) {
      case 'next':
      case 'previous':
        setActiveIndex(moveActiveIndex(active, candidates.length, action === 'next' ? 1 : -1));
        break;
      case 'select':
        pick(candidates[active]);
        break;
      case 'close':
        setDismissedStart(mention?.start ?? null);
        break;
      case 'highlightCreate':
        setCreateHighlighted(true);
        break;
      case 'unhighlightCreate':
        setCreateHighlighted(false);
        break;
      case 'toggleKind':
        setChosenKind(kinds[(kinds.indexOf(kind) + 1) % kinds.length]);
        break;
      case 'create':
        void create();
        break;
    }
  };

  const activeOptionId = !opened
    ? undefined
    : candidates.length > 0
      ? mentionOptionId(listId, active)
      : createAvailable && createHighlighted
        ? mentionOptionId(listId, 'create')
        : undefined;

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
            aria-controls={opened && (candidates.length > 0 || createAvailable) ? listId : undefined}
            aria-activedescendant={activeOptionId}
          />
        </Box>
      </Popover.Target>
      {/* Clicks inside keep the focus (and caret) in the textarea. */}
      <Popover.Dropdown p={4} onMouseDown={(event) => event.preventDefault()}>
        <MentionSuggestions
          listId={listId}
          candidates={candidates}
          activeIndex={active}
          onHover={setActiveIndex}
          onPick={pick}
          create={
            createAvailable
              ? {
                  name: newName,
                  kinds,
                  kind,
                  onKindChange: setChosenKind,
                  highlighted: createHighlighted,
                  creating,
                  onCreate: () => void create(),
                }
              : null
          }
        />
      </Popover.Dropdown>
    </Popover>
  );
}
