import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { Box, Button, Group, Paper, Portal, Stack, Text, Title } from '@mantine/core';
import { useHotkeys, useMediaQuery } from '@mantine/hooks';
import { useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { exitDemo } from '../../lib/demo/demoMode';
import { TOUR_STEPS, setTourStep, useGoToTourStep, useTourStep } from '../../lib/demo/tour';

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

/** The highlight around an element, cut to the screen so a tall section still shows its edge. */
function spotOf(element: Element): Spot {
  const rect = element.getBoundingClientRect();
  const top = Math.max(rect.top - PAD, 0);
  const bottom = Math.min(rect.bottom + PAD, window.innerHeight);
  return { top, left: rect.left - PAD, width: rect.width + 2 * PAD, height: Math.max(bottom - top, 0) };
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
  const onPage = step !== null && location.pathname === step.path;
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
