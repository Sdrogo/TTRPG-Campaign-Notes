import { ActionIcon, FileButton, Group, Tooltip } from '@mantine/core';
import { ImageIcon, LinkIcon } from '@phosphor-icons/react';
import { ACCEPTED_IMAGE_TYPES } from '../lib/images';
import { ImageUrlPopover } from './ImageUrlPopover';
import { useTranslation } from 'react-i18next';

interface ImageAttachButtonsProps {
  /** How many more images may be added; the buttons disable at 0. */
  remaining: number;
  onAddFiles: (files: File[]) => void;
  onAddUrl: (url: string) => void;
}

/**
 * Compact "attach an image" controls for a form: a file picker and a URL field
 * in a popover. Nothing is uploaded here - the form decides when.
 */
export function ImageAttachButtons({ remaining, onAddFiles, onAddUrl }: ImageAttachButtonsProps) {
  const { t } = useTranslation();
  const full = remaining <= 0;
  const hint = full ? t('images.limitReached') : undefined;

  return (
    <Group gap={4}>
      <FileButton
        onChange={(files) => onAddFiles(files.slice(0, remaining))}
        accept={ACCEPTED_IMAGE_TYPES}
        multiple
        disabled={full}
      >
        {(props) => (
          <Tooltip label={hint ?? t('images.attachFilesTooltip')} withArrow>
            <ActionIcon {...props} variant="subtle" color="gray" aria-label={t('images.attachFiles')}>
              <ImageIcon size={18} />
            </ActionIcon>
          </Tooltip>
        )}
      </FileButton>
      <ImageUrlPopover onAddUrl={onAddUrl}>
        {(toggle) => (
          <Tooltip label={hint ?? t('images.attachUrl')} withArrow>
            <ActionIcon
              variant="subtle"
              color="gray"
              disabled={full}
              onClick={toggle}
              aria-label={t('images.attachUrl')}
            >
              <LinkIcon size={18} />
            </ActionIcon>
          </Tooltip>
        )}
      </ImageUrlPopover>
    </Group>
  );
}
