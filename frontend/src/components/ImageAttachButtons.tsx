import { ActionIcon, FileButton, Group, Tooltip } from '@mantine/core';
import { ImageIcon, LinkIcon } from '@phosphor-icons/react';
import { ACCEPTED_IMAGE_TYPES } from '../lib/images';
import { ImageUrlPopover } from './ImageUrlPopover';

interface ImageAttachButtonsProps {
  // How many more images may be added; the buttons disable at 0.
  remaining: number;
  onAddFiles: (files: File[]) => void;
  onAddUrl: (url: string) => void;
}

// Compact "attach an image" controls for a form: a file picker and a URL
// field in a popover. Nothing is uploaded here - the form decides when.
export function ImageAttachButtons({ remaining, onAddFiles, onAddUrl }: ImageAttachButtonsProps) {
  const full = remaining <= 0;
  const hint = full ? 'Limite di immagini raggiunto' : undefined;

  return (
    <Group gap={4}>
      <FileButton
        onChange={(files) => onAddFiles(files.slice(0, remaining))}
        accept={ACCEPTED_IMAGE_TYPES}
        multiple
        disabled={full}
      >
        {(props) => (
          <Tooltip label={hint ?? 'Aggiungi immagini dal computer'} withArrow>
            <ActionIcon {...props} variant="subtle" color="gray" aria-label="Aggiungi immagini">
              <ImageIcon size={18} />
            </ActionIcon>
          </Tooltip>
        )}
      </FileButton>
      <ImageUrlPopover onAddUrl={onAddUrl}>
        {(toggle) => (
          <Tooltip label={hint ?? 'Aggiungi immagine da URL'} withArrow>
            <ActionIcon
              variant="subtle"
              color="gray"
              disabled={full}
              onClick={toggle}
              aria-label="Aggiungi immagine da URL"
            >
              <LinkIcon size={18} />
            </ActionIcon>
          </Tooltip>
        )}
      </ImageUrlPopover>
    </Group>
  );
}
