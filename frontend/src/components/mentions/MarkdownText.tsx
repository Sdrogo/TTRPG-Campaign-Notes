import { useMemo, type ReactNode } from 'react';
import { Anchor, Box, type BoxProps } from '@mantine/core';
import Markdown, { type Components } from 'react-markdown';
import remarkBreaks from 'remark-breaks';
import remarkGfm from 'remark-gfm';
import {
  mentionPlaceholder,
  rehypePlaceMentions,
  safeLinkUrl,
  withoutPlaceholderMarks,
} from '../../lib/markdownText';
import type { Root as MdastRoot, RootContent as MdastContent } from 'mdast';
import { useMentionSegments } from '../../hooks/useMentionSegments';
import { MentionSegmentView } from './MentionText';

interface MarkdownTextProps extends BoxProps {
  /** A Document description or a Note text, as stored. */
  text: string;
}

// Decision 3: raw HTML is shown as the text it is, never run.
function htmlAsText() {
  const visit = (node: MdastRoot | MdastContent) => {
    if (node.type === 'html') {
      (node as unknown as { type: string }).type = 'text';
    } else if ('children' in node) {
      node.children.forEach(visit);
    }
  };
  return (tree: MdastRoot) => visit(tree);
}

// Decision 5: `#` is at most the size of a Note title, under the page's own
// headings (the Document name is an h1, a Note title an h2).
const HEADING_TAGS = { h1: 'h3', h2: 'h4', h3: 'h5', h4: 'h6', h5: 'h6', h6: 'h6' } as const;

/**
 * A Document description or a Note text read as Markdown (spec 48):
 * CommonMark plus tables, strikethrough, task lists and bare links, a single
 * line break kept as one. Raw HTML is shown as text, only `http`, `https` and
 * `mailto` addresses are links and an image is only a link to it (Decision
 * 3). `#` mentions work anywhere in it, as in `MentionText`.
 */
export function MarkdownText({ text, className, ...boxProps }: MarkdownTextProps) {
  const segments = useMentionSegments(text);
  const { source, mentions, written } = useMemo(() => {
    const found: Exclude<(typeof segments)[number], { kind: 'text' }>[] = [];
    const asWritten: string[] = [];
    const lifted = segments
      .map((segment) => {
        if (segment.kind === 'text') return withoutPlaceholderMarks(segment.text);
        found.push(segment);
        // No member tokens here: `useMentionSegments` gets no members.
        asWritten.push((segment as { text: string }).text);
        return mentionPlaceholder(found.length - 1);
      })
      .join('');
    return { source: lifted, mentions: found, written: asWritten };
  }, [segments]);

  const rehypePlugins = useMemo(() => [rehypePlaceMentions(written)], [written]);

  const components = useMemo((): Components => {
    const headings = Object.fromEntries(
      Object.entries(HEADING_TAGS).map(([from, to]) => [
        from,
        ({ children }: { children?: ReactNode }) => {
          const Tag = to;
          return <Tag className={`markdown-heading markdown-${from}`}>{children}</Tag>;
        },
      ]),
    );
    return {
      ...headings,
      // A div, not a <p>: a Document mention's hover preview renders a whole card.
      p: ({ children }) => <div className="markdown-p">{children}</div>,
      span: ({ node }) => {
        // Every span is a mention: raw HTML never makes one (Decision 3).
        const { dataMention, dataInLink } = node!.properties;
        return (
          <MentionSegmentView segment={mentions[Number(dataMention)]} linked={dataInLink === undefined} />
        );
      },
      a: ({ href, children }) => {
        const url = safeLinkUrl(href!);
        return url ? (
          <Anchor href={url} target="_blank" rel="noopener noreferrer" inherit>
            {children}
          </Anchor>
        ) : (
          <span>{children}</span>
        );
      },
      img: ({ src, alt }) => {
        const url = safeLinkUrl(src as string);
        const label = alt || url;
        return url ? (
          <Anchor href={url} target="_blank" rel="noopener noreferrer" inherit>
            {label}
          </Anchor>
        ) : (
          <span>{alt}</span>
        );
      },
      table: ({ children }) => (
        <div className="markdown-table">
          <table>{children}</table>
        </div>
      ),
    };
  }, [mentions]);

  // A div, like `MentionText`: a mention's hover preview renders a whole card.
  return (
    <Box className={['markdown-text', className].filter(Boolean).join(' ')} {...boxProps}>
      <Markdown
        remarkPlugins={[remarkGfm, remarkBreaks, htmlAsText]}
        rehypePlugins={rehypePlugins}
        components={components}
        urlTransform={(url) => url}
      >
        {source}
      </Markdown>
    </Box>
  );
}
