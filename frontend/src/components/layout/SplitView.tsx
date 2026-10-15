import { useLayoutEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react';
import { Box } from '@mantine/core';
import { useTranslation } from 'react-i18next';
import { clampRatio, KEY_STEP, storedRatio, storeRatio } from '../../lib/splitView';

const DIVIDER_WIDTH = 8;

/**
 * Two panes side by side with a divider between them (spec 37 Decision 3):
 * dragged with the pointer, or moved with the arrow keys once focused. The
 * left pane's share of the width is remembered in the browser.
 */
export function SplitView({ left, right }: { left: ReactNode; right: ReactNode }) {
  const { t } = useTranslation();
  const container = useRef<HTMLDivElement>(null);
  const [ratio, setRatio] = useState(storedRatio);

  // A width remembered on a wider screen, or kept while the window narrows,
  // may not fit: fit it before the first paint and on every resize, without
  // forgetting what was chosen.
  useLayoutEffect(() => {
    const element = container.current!;
    const fit = () => setRatio((current) => clampRatio(current, element.getBoundingClientRect().width));
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const update = (next: number) => {
    const clamped = clampRatio(next, container.current!.getBoundingClientRect().width);
    setRatio(clamped);
    storeRatio(clamped);
  };

  const handlePointerDown = (event: PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const handlePointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (!event.currentTarget.hasPointerCapture(event.pointerId)) {
      return;
    }
    const rect = container.current!.getBoundingClientRect();
    update((event.clientX - rect.left) / rect.width);
  };
  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'ArrowLeft') {
      update(ratio - KEY_STEP);
    } else if (event.key === 'ArrowRight') {
      update(ratio + KEY_STEP);
    }
  };

  return (
    <Box ref={container} style={{ display: 'flex', alignItems: 'stretch', width: '100%' }}>
      <Box
        pr={8}
        style={{
          width: `calc(${ratio * 100}% - ${DIVIDER_WIDTH / 2}px)`,
          minWidth: 0,
        }}
      >
        {left}
      </Box>
      <Box
        role="separator"
        tabIndex={0}
        aria-orientation="vertical"
        aria-label={t('documents.open.resize')}
        aria-valuenow={Math.round(ratio * 100)}
        aria-valuemin={0}
        aria-valuemax={100}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onKeyDown={handleKeyDown}
        className="split-divider"
        style={{
          width: DIVIDER_WIDTH,
          flexShrink: 0,
          cursor: 'col-resize',
          touchAction: 'none',
          alignSelf: 'stretch',
          display: 'flex',
          justifyContent: 'center',
        }}
      >
        <Box
          style={{
            width: 2,
            background: 'var(--border-default)',
            borderRadius: 1,
          }}
        />
      </Box>
      <Box pl={8} style={{ flex: 1, minWidth: 0 }}>
        {right}
      </Box>
    </Box>
  );
}
