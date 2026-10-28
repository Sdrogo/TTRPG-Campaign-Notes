import { useEffect, useId, useImperativeHandle, useLayoutEffect, useRef, useState, type KeyboardEvent, type Ref } from 'react';
import { Box, Popover, Textarea, type TextareaProps } from '@mantine/core';
import { useDocumentMentions } from '../../hooks/useDocumentMentions';
import { notifyError } from '../../lib/notify';
import { findMember, memberDisplayName } from '../../lib/members';
import {
  applyDisplayEdit,
  filterMemberCandidates,
  mentionToken,
  replaceDisplayRange,
  toDisplay,
  USER_MENTION_PREFIX,
  type TokenOptions,
} from '../../lib/mentionTokens';
import type { Insertion } from '../../lib/markdownEditing';
import type { Member } from '../../types/member';
import {
  creatableKinds,
  filterMentionCandidates,
  findMentionQuery,
  insertMention,
  isHeadingStart,
  isFinishedMention,
  mentionKeyAction,
  mentionOptionId,
  mentionTargetId,
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
  /**
   * The Room's members, to mention with `@` (Comments only, spec 19c). Then
   * `value` also holds `@[Name](user:<uuid>)` tokens, shown as `@Name`.
   */
  members?: Member[];
  /** For a toolbar acting on the text (spec 48): the textarea and a way to add to it. */
  controlRef?: Ref<MentionTextareaControl>;
  /**
   * A Markdown text (spec 48): a `#` at the start of a line opens no
   * suggestions until a name starts, since it may be a heading.
   */
  markdown?: boolean;
}

/** What `controlRef` gives a toolbar. */
export interface MentionTextareaControl {
  /** The textarea, to read its selection; it shows `#Name` for each token. */
  textarea: () => HTMLTextAreaElement | null;
  /**
   * Adds `insertions` (positions in what the textarea shows), keeping every
   * token whole, then focuses the textarea and selects `selection`.
   */
  insert: (insertions: Insertion[], selection: [number, number]) => void;
}

/**
 * A `Textarea` that suggests the Room's Documents and Tags when a word starts
 * with `#` (arrows + Enter/Tab, or a click, to pick one; Esc to dismiss). When
 * nothing matches, the typed name can be created as a blank Document or a Tag.
 * A pick is stored as a `#[Name](doc:<uuid>)` / `#[Name](tag:<uuid>)` token
 * (spec 20), shown as `#Name`. Given `members`, a word starting with `@`
 * suggests them the same way. Works as a plain textarea outside a
 * `DocumentMentionsProvider` and without `members`.
 */
export function MentionTextarea({
  value,
  onChange,
  onKeyDown,
  onBlur,
  members,
  controlRef,
  markdown = false,
  ...props
}: MentionTextareaProps) {
  const mentions = useDocumentMentions();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const pendingCaret = useRef<number | [number, number] | null>(null);
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

  // What the textarea shows: `value` with every token as `#Name` (and, in
  // Comments, `@Name`), under its target's current name while the viewer
  // sees it, so a rename shows here too. The stored token is left as is.
  const tokens: TokenOptions = {
    users: members !== undefined,
    currentName: (kind, targetId) => {
      if (kind === 'user') {
        const member = members && findMember(members, targetId);
        return member ? memberDisplayName(member) : undefined;
      }
      const targets = kind === 'doc' ? mentions?.documents : mentions?.tags;
      return targets?.find((target) => target.id === targetId)?.name;
    },
  };
  const display = toDisplay(value, tokens);
  const prefixes = `${mentions ? '#' : ''}${members ? USER_MENTION_PREFIX : ''}`;
  const mention = prefixes && caret !== null ? findMentionQuery(display, caret, prefixes) : null;
  const forMember = members !== undefined && mention !== null && display[mention.start] === USER_MENTION_PREFIX;
  // Cheap enough (a Room's members, Documents and Tags) to redo on every render.
  const candidates: MentionTarget[] =
    mention === null
      ? []
      : forMember
        ? filterMemberCandidates(members, mention.query).map((member) => ({ kind: 'member', member }))
        : filterMentionCandidates(mentions!.documents, mentions!.tags, mention.query);
  const finished =
    mention !== null &&
    isFinishedMention(
      mention.query,
      forMember
        ? members.map(memberDisplayName)
        : [...mentions!.documents.map((document) => document.name), ...mentions!.tags.map((tag) => tag.name)],
    );
  const kinds = mentions && !forMember ? creatableKinds(mentions) : [];
  const kind = chosenKind !== null && kinds.includes(chosenKind) ? chosenKind : kinds[0];
  const newName = mention ? newEntryName(mention.query) : '';
  const createAvailable = candidates.length === 0 && kind !== undefined && newName !== '';
  // Names can have spaces, so the popup stays open past a space while
  // something matches or can be created.
  const opened =
    mention !== null &&
    !finished &&
    mention.start !== dismissedStart &&
    !(markdown && display[mention.start] === '#' && isHeadingStart(display, mention)) &&
    (candidates.length > 0 || createAvailable || !/\s/.test(mention.query));
  const active = Math.min(activeIndex, Math.max(candidates.length - 1, 0));

  // Put the caret right after an inserted mention, once React has rendered
  // the new value.
  useLayoutEffect(() => {
    const textarea = textareaRef.current;
    if (textarea && pendingCaret.current !== null) {
      const [start, end] =
        typeof pendingCaret.current === 'number'
          ? [pendingCaret.current, pendingCaret.current]
          : pendingCaret.current;
      textarea.focus();
      textarea.setSelectionRange(start, end);
      pendingCaret.current = null;
    }
  }, [value]);

  useImperativeHandle(controlRef, () => ({
    textarea: () => textareaRef.current,
    insert: (insertions, selection) => {
      // From the end back, so earlier positions still hold.
      const stored = insertions
        .toSorted((a, b) => b.at - a.at)
        .reduce((text, insertion) => replaceDisplayRange(text, insertion.at, insertion.at, insertion.text, tokens), value);
      pendingCaret.current = selection;
      latest.current.onChange(stored);
    },
  }));

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

  // Writes the target's token (shown as `#Name` or `@Name`) over the query
  // in `stored` and closes the popup for it. `at` and `queryEnd` are
  // positions in what the textarea shows.
  const complete = (stored: string, at: MentionQuery, queryEnd: number, target: MentionTarget) => {
    const name = mentionTargetName(target);
    const prefix = target.kind === 'member' ? USER_MENTION_PREFIX : '#';
    const result = insertMention(toDisplay(stored, tokens), at, queryEnd, name, prefix);
    // What was written, then a space if `insertMention` added one.
    const written = result.text.slice(at.start, result.caret);
    const kind = target.kind === 'member' ? 'user' : target.kind === 'document' ? 'doc' : 'tag';
    const inserted = mentionToken(kind, mentionTargetId(target), name) + written.slice(prefix.length + name.length);
    pendingCaret.current = result.caret;
    setCaret(result.caret);
    setDismissedStart(at.start);
    latest.current.onChange(replaceDisplayRange(stored, at.start, queryEnd, inserted, tokens));
  };

  // Only reachable (keyboard 'select', or clicking a rendered suggestion)
  // while the popup is open, which itself requires a `mention` - and by its
  // own definition, only ever set once `caret` is too.
  const pick = (target: MentionTarget) => {
    complete(value, mention as MentionQuery, caret as number, target);
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
      const shown = toDisplay(text, tokens);
      if (shown.slice(mention.start, mention.start + typed.length) === typed) {
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
    // `action` only comes from `mentionKeyAction`, called only while `opened`
    // - which itself requires a `mention` - so it's set on every case below.
    const activeMention = mention as MentionQuery;
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
        setDismissedStart(activeMention.start);
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
            spellCheck
            {...props}
            ref={textareaRef}
            value={display}
            onChange={(event) => {
              const next = event.currentTarget.value;
              const editedTo = event.currentTarget.selectionStart;
              onChange(applyDisplayEdit(value, next, editedTo, tokens));
              trackCaret(event.currentTarget);
            }}
            onSelect={(event) => trackCaret(event.currentTarget)}
            onKeyDown={handleKeyDown}
            onBlur={(event) => {
              setCaret(null);
              onBlur?.(event);
            }}
            role={prefixes ? 'combobox' : undefined}
            aria-autocomplete={prefixes ? 'list' : undefined}
            aria-expanded={prefixes ? opened : undefined}
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
