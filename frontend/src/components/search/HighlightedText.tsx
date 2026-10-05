import { highlightSegments } from '../../lib/search';
import type { Highlighted } from '../../types/search';

interface HighlightedTextProps {
  value: Highlighted;
}

/**
 * Text with its matched words marked (spec 21 Decision 3). The backend sends
 * offsets, never HTML, so user text is only ever rendered as text.
 */
export function HighlightedText({ value }: HighlightedTextProps) {
  return (
    <>
      {highlightSegments(value).map((segment, index) =>
        segment.match ? (
          <mark key={index} className="search-match">
            {segment.text}
          </mark>
        ) : (
          <span key={index}>{segment.text}</span>
        ),
      )}
    </>
  );
}
