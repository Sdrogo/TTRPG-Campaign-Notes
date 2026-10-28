import { useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { Anchor, Box, Group, Input, Popover, SegmentedControl, Table, Text } from '@mantine/core';
import {
  LinkSimpleIcon,
  ListBulletsIcon,
  ListNumbersIcon,
  QuotesIcon,
  TextBIcon,
  TextHTwoIcon,
  TextItalicIcon,
} from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';
import { LabeledActionIcon } from '../LabeledActionIcon';
import { MarkdownText } from './MarkdownText';
import { MentionTextarea, type MentionTextareaControl } from './MentionTextarea';
import { markdownEdit, markdownShortcut, type MarkdownAction } from '../../lib/markdownEditing';

interface MarkdownEditorProps {
  label: ReactNode;
  description?: ReactNode;
  value: string;
  onChange: (value: string) => void;
  minRows?: number;
  autosize?: boolean;
  autoFocus?: boolean;
}

const ACTIONS: { action: MarkdownAction; icon: ReactNode }[] = [
  { action: 'bold', icon: <TextBIcon size={18} /> },
  { action: 'italic', icon: <TextItalicIcon size={18} /> },
  { action: 'heading', icon: <TextHTwoIcon size={18} /> },
  { action: 'bulleted', icon: <ListBulletsIcon size={18} /> },
  { action: 'numbered', icon: <ListNumbersIcon size={18} /> },
  { action: 'quote', icon: <QuotesIcon size={18} /> },
  { action: 'link', icon: <LinkSimpleIcon size={18} /> },
];

// The cheat sheet: what to write (with `text`, `heading` and `item` as
// sample words in the UI language), and what it gives.
type HelpLabel = MarkdownAction | 'code' | 'strike' | 'table';
const HELP: {
  written: (sample: { text: string; heading: string; item: string }) => string;
  label: HelpLabel;
}[] = [
  { written: ({ text }) => `**${text}**`, label: 'bold' },
  { written: ({ text }) => `*${text}*`, label: 'italic' },
  { written: ({ text }) => `~~${text}~~`, label: 'strike' },
  { written: ({ heading }) => `## ${heading}`, label: 'heading' },
  { written: ({ item }) => `- ${item}`, label: 'bulleted' },
  { written: ({ item }) => `1. ${item}`, label: 'numbered' },
  { written: ({ text }) => `> ${text}`, label: 'quote' },
  { written: ({ text }) => `[${text}](https://…)`, label: 'link' },
  { written: ({ text }) => `\`${text}\``, label: 'code' },
  { written: () => '| a | b |\n| - | - |\n| 1 | 2 |', label: 'table' },
];

function MarkdownHelp() {
  const { t } = useTranslation();
  const sample = {
    text: t('markdown.sample.text'),
    heading: t('markdown.sample.heading'),
    item: t('markdown.sample.item'),
  };
  return (
    <Popover width={320} position="bottom-start" shadow="md" withArrow>
      <Popover.Target>
        <Anchor component="button" type="button" size="xs" data-testid="markdown-help">
          {t('markdown.help')}
        </Anchor>
      </Popover.Target>
      <Popover.Dropdown>
        <Text size="sm" fw={600} mb="xs">
          {t('markdown.helpTitle')}
        </Text>
        <Table withRowBorders={false} verticalSpacing={2} horizontalSpacing="xs" fz="xs">
          <Table.Tbody>
            {HELP.map((row) => (
              <Table.Tr key={row.label}>
                <Table.Td style={{ whiteSpace: 'pre', fontFamily: 'var(--font-mono)' }}>
                  {row.written(sample)}
                </Table.Td>
                <Table.Td>{t(`markdown.actions.${row.label}`)}</Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </Popover.Dropdown>
    </Popover>
  );
}

/**
 * A description or Note text field (spec 48 Decision 7): the `#` mention
 * textarea, a toolbar that adds Markdown signs around the selection (also
 * Ctrl/Cmd+B, I and K), a Write / Preview switch and a cheat sheet.
 */
export function MarkdownEditor({
  label,
  description,
  value,
  onChange,
  ...textareaProps
}: MarkdownEditorProps) {
  const { t } = useTranslation();
  const id = useId();
  const control = useRef<MentionTextareaControl>(null);
  const [preview, setPreview] = useState(false);

  const apply = (action: MarkdownAction) => {
    // The toolbar and the shortcuts only exist while the textarea does.
    const current = control.current!;
    const textarea = current.textarea()!;
    const edit = markdownEdit(action, textarea.value, textarea.selectionStart, textarea.selectionEnd);
    current.insert(edit.insertions, edit.selection);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    const action = markdownShortcut(event);
    if (action) {
      event.preventDefault();
      apply(action);
    }
  };

  return (
    <Input.Wrapper
      label={label}
      labelProps={{ htmlFor: id }}
      description={
        <>
          {description} <MarkdownHelp />
        </>
      }
    >
      <Group justify="space-between" gap="xs" mt={4} mb={4} wrap="wrap">
        {/* Not while previewing: there is no selection to act on. */}
        {!preview && (
          <Group gap={2} role="toolbar" aria-label={t('markdown.toolbar')}>
            {ACTIONS.map(({ action, icon }) => (
              <LabeledActionIcon
                key={action}
                variant="subtle"
                color="gray"
                size="md"
                aria-label={t(`markdown.actions.${action}`)}
                // Keeps the selection in the textarea.
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => apply(action)}
              >
                {icon}
              </LabeledActionIcon>
            ))}
          </Group>
        )}
        <SegmentedControl
          ml="auto"
          size="xs"
          value={preview ? 'preview' : 'write'}
          onChange={(mode) => setPreview(mode === 'preview')}
          data={[
            { value: 'write', label: t('markdown.write') },
            { value: 'preview', label: t('markdown.preview') },
          ]}
        />
      </Group>
      {preview ? (
        <Box className="markdown-preview" data-testid="markdown-preview" style={{ minHeight: '4.8em' }}>
          {value.trim() ? (
            <MarkdownText text={value} style={{ overflowWrap: 'anywhere' }} />
          ) : (
            <Text c="dimmed" size="sm">
              {t('markdown.previewEmpty')}
            </Text>
          )}
        </Box>
      ) : (
        <MentionTextarea
          {...textareaProps}
          id={id}
          value={value}
          onChange={onChange}
          onKeyDown={handleKeyDown}
          controlRef={control}
          markdown
        />
      )}
    </Input.Wrapper>
  );
}
