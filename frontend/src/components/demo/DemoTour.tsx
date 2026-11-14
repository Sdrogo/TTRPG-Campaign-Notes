import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { Box, Button, Group, Paper, Portal, Stack, Text, Title } from '@mantine/core';
import { useHotkeys, useMediaQuery } from '@mantine/hooks';
import { useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { exitDemo } from '../../lib/demo/demoMode';
import { TOUR_CHAPTERS, TOUR_STEPS, chapterStart, setTourStep, stepPathname, useGoToTourStep, useTourStep } from '../../lib/demo/tour';

// Room around the highlighted element, the gap to the card, the card's width
// and the screen margin it keeps.
const PAD = 6;
const GAP = 12;
const CARD_WIDTH = 340;
const MARGIN = 16;
// Below this much free height on either side of the element, the card docks
// to the bottom of the screen instead.
const CARD_ROOM = 220;

interface Spot {
  top: number;
  left: number;
  width: number;
  height: number;
}

/** The first visible element carrying `data-tour="<target>"`, the button or its phone twin. */
function findTarget(target: string): Element | null {
  for (const element of document.querySelectorAll(`[data-tour="${target}"]`)) {
    const rect = element.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) return element;
  }
  return null;
}

// Block boxes run under a float beside them; only their lines wrap around it.
const SPANS_FLOAT = new Set(['block', 'list-item', 'inline', 'contents', 'none']);

/**
 * The right edge of what an element shows: its text lines and the boxes that
 * sit beside a float (flex, inline-block, images...), not its block boxes.
 * On the Document page the text wraps around the floated aside (images, maps),
 * but its blocks span the full width behind it, so their own box would light
 * the aside too.
 */
function contentRight(element: Element): number | null {
  let right: number | null = null;
  const grow = (edge: number) => {
    right = right === null ? edge : Math.max(right, edge);
  };
  const range = document.createRange();
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    // `Text` here is Mantine's component, so the node type tells text apart.
    if (node.nodeType === Node.TEXT_NODE) {
      if (!(node as Text).data.trim()) continue;
      range.selectNodeContents(node);
      for (const line of range.getClientRects()) if (line.width > 0) grow(line.right);
    } else if (!SPANS_FLOAT.has(getComputedStyle(node as Element).display)) {
      const box = (node as Element).getBoundingClientRect();
      if (box.width > 0) grow(box.right);
    }
  }
  return right;
}

/**
 * The highlight around an element, cut to the screen so a tall section still
 * shows its edge. An element marked `data-tour-fit="content"` is lit only as
 * wide as its content, so the float its text wraps around stays dimmed.
 */
function spotOf(element: Element): Spot {
  const rect = element.getBoundingClientRect();
  const top = Math.max(rect.top - PAD, 0);
  const bottom = Math.min(rect.bottom + PAD, window.innerHeight);
  const fitted = element.getAttribute('data-tour-fit') === 'content' ? contentRight(element) : null;
  const edge = rect.left + rect.width;
  const right = fitted === null ? edge : Math.min(fitted, edge);
  return { top, left: rect.left - PAD, width: right - rect.left + 2 * PAD, height: Math.max(bottom - top, 0) };
}

/** Whether two highlights are the same place, so an unchanged one causes no render. */
const sameSpot = (a: Spot | null, b: Spot | null) => JSON.stringify(a) === JSON.stringify(b);

/** Where the card goes: under or over the highlight, else docked at the bottom; centered without one. */
function cardStyle(spot: Spot | null, phone: boolean): CSSProperties {
  const docked = { left: MARGIN, right: MARGIN, bottom: MARGIN, marginInline: 'auto', maxWidth: CARD_WIDTH };
  if (phone) return docked;
  if (!spot) return { top: '50%', left: '50%', transform: 'translate(-50%, -50%)', width: CARD_WIDTH };
  const left = Math.min(Math.max(spot.left, MARGIN), window.innerWidth - CARD_WIDTH - MARGIN);
  const below = window.innerHeight - (spot.top + spot.height);
  if (below >= CARD_ROOM) return { top: spot.top + spot.height + GAP, left, width: CARD_WIDTH };
  if (spot.top >= CARD_ROOM) return { bottom: window.innerHeight - spot.top + GAP, left, width: CARD_WIDTH };
  return docked;
}

/**
 * The Demo's guided tour (spec 45_3): while a step is open, the element it
 * points at is lit and the rest of the page dimmed, with a card that explains
 * it, Back / Next, the step count and Skip. The page stays usable underneath.
 * Shown on a phone too, the card docked at the bottom. Rendered by
 * `DemoBanner`, so only while the Demo is on.
 */
export function DemoTour() {
  const { t } = useTranslation();
  const index = useTourStep();
  const goTo = useGoToTourStep();
  const location = useLocation();
  const phone = useMediaQuery('(max-width: 48em)', false, { getInitialValueInEffect: false });
  const [spot, setSpot] = useState<Spot | null>(null);
  const scrolledTo = useRef<string | null>(null);

  const step = index === null ? null : TOUR_STEPS[index];
  const onPage = step !== null && location.pathname === stepPathname(step);
  const target = onPage ? step.target : null;

  // The element can appear late (the page loads its data) and move (scroll,
  // resize, a panel opening), so the highlight follows it.
  useEffect(() => {
    if (!target) return;
    const update = () => {
      const element = findTarget(target);
      const key = `${index}:${location.pathname}`;
      if (element && scrolledTo.current !== key) {
        scrolledTo.current = key;
        element.scrollIntoView({ block: 'center' });
      }
      const next = element && spotOf(element);
      setSpot((current) => (sameSpot(current, next) ? current : next));
    };
    update();
    const timer = window.setInterval(update, 250);
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
    };
  }, [target, index, location.pathname]);

  useHotkeys([['Escape', () => setTourStep(null)]]);

  if (index === null || step === null) return null;
  const last = index === TOUR_STEPS.length - 1;
  const lit = target ? spot : null;

  return (
    <Portal>
      <Box
        className="demo-tour-spot"
        data-lit={lit ? true : undefined}
        style={lit ? { top: lit.top, left: lit.left, width: lit.width, height: lit.height } : undefined}
        aria-hidden="true"
      />
      <Paper
        className="demo-tour-card"
        role="dialog"
        aria-labelledby="demo-tour-title"
        aria-describedby="demo-tour-body"
        withBorder
        shadow="lg"
        radius="md"
        p="md"
        style={cardStyle(lit, phone)}
      >
        <Stack gap="xs">
          <Text size="xs" c="dimmed">
            {t('tour.label')} · {t('tour.counter', { current: index + 1, total: TOUR_STEPS.length })}
          </Text>
          <Group gap={4} role="group" aria-label={t('tour.chapterLabel')}>
            {TOUR_CHAPTERS.map((chapter) => (
              <Button
                key={chapter}
                size="compact-xs"
                variant={step.chapter === chapter ? 'filled' : 'light'}
                aria-pressed={step.chapter === chapter}
                onClick={() => goTo(chapterStart(chapter))}
              >
                {t(`tour.chapters.${chapter}`)}
              </Button>
            ))}
          </Group>
          <Title order={2} fz="h4" id="demo-tour-title">
            {t(`tour.steps.${step.id}.title`)}
          </Title>
          <Text size="sm" id="demo-tour-body">
            {t(`tour.steps.${step.id}.body`)}
          </Text>
          {last ? (
            <Group gap="xs" justify="flex-end">
              <Button size="compact-sm" variant="default" onClick={() => setTourStep(null)}>
                {t('tour.keepExploring')}
              </Button>
              <Button
                size="compact-sm"
                onClick={() => {
                  setTourStep(null);
                  exitDemo('/#sign-in');
                }}
              >
                {t('tour.signIn')}
              </Button>
            </Group>
          ) : (
            <Group gap="xs" justify="space-between">
              <Button size="compact-sm" variant="subtle" color="gray" onClick={() => setTourStep(null)}>
                {t('tour.skip')}
              </Button>
              <Group gap="xs">
                {index > 0 && (
                  <Button size="compact-sm" variant="default" onClick={() => goTo(index - 1)}>
                    {t('tour.back')}
                  </Button>
                )}
                <Button size="compact-sm" onClick={() => goTo(index + 1)}>
                  {t('tour.next')}
                </Button>
              </Group>
            </Group>
          )}
        </Stack>
      </Paper>
    </Portal>
  );
}
