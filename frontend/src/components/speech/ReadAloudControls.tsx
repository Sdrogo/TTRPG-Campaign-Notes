import { Group } from '@mantine/core';
import { PauseIcon, PlayIcon, SpeakerHighIcon, StopIcon } from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';
import { useReadAloud } from '../../hooks/useReadAloud';
import { speechSupported } from '../../lib/speech';
import { LabeledActionIcon } from '../LabeledActionIcon';

interface ReadAloudControlsProps {
  /** Which source this is, unique on the page (`document:…`, `note:…`). */
  sourceId: string;
  /** What the controls read, named in their labels. */
  name: string;
  /** The text to read, built when play is pressed. */
  getText: () => string;
  /** `sm` in a Note's row of actions, `md` in the Document header. */
  size?: 'sm' | 'md';
}

/**
 * The read-aloud icons (spec 30 Decision 3): a speaker that starts reading
 * `name`, which becomes Pause/Resume and Stop while it plays. Nothing at all
 * when the browser can't speak (Decision 1).
 */
export function ReadAloudControls({
  sourceId,
  name,
  getText,
  size = 'md',
}: ReadAloudControlsProps) {
  const { t } = useTranslation();
  const reading = useReadAloud(sourceId, getText);
  const iconSize = size === 'sm' ? 16 : 20;
  const actionSize = size === 'sm' ? 'sm' : undefined;

  if (!speechSupported()) return null;

  if (reading.status === 'idle') {
    return (
      <LabeledActionIcon
        variant="subtle"
        color="gray"
        size={actionSize}
        onClick={reading.play}
        aria-label={t('speech.listen', { name })}
      >
        <SpeakerHighIcon size={iconSize} />
      </LabeledActionIcon>
    );
  }

  const paused = reading.status === 'paused';
  return (
    <Group gap={4} wrap="nowrap">
      <LabeledActionIcon
        variant="light"
        color="accent"
        size={actionSize}
        onClick={paused ? reading.resume : reading.pause}
        aria-label={paused ? t('speech.resume') : t('speech.pause')}
      >
        {paused ? <PlayIcon size={iconSize} /> : <PauseIcon size={iconSize} />}
      </LabeledActionIcon>
      <LabeledActionIcon
        variant="subtle"
        color="gray"
        size={actionSize}
        onClick={reading.stop}
        aria-label={t('speech.stop')}
      >
        <StopIcon size={iconSize} />
      </LabeledActionIcon>
    </Group>
  );
}
