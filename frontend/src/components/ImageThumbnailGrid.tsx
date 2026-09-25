import { ActionIcon, Box, Group, Image, UnstyledButton } from '@mantine/core';
import { XIcon } from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';

/** One image in an `ImageThumbnailGrid`: stored or still pending. */
export interface Thumbnail {
  id: string;
  url: string;
  label: string;
}

interface ImageThumbnailGridProps {
  images: Thumbnail[];
  size?: number;
  /** Makes each thumbnail clickable (e.g. to open a fullscreen viewer). */
  onOpen?: (index: number) => void;
  /** Shows a remove button on each thumbnail. */
  onRemove?: (id: string) => void;
}

/** A wrapping row of square image thumbnails. */
export function ImageThumbnailGrid({ images, size = 96, onOpen, onRemove }: ImageThumbnailGridProps) {
  const { t } = useTranslation();

  if (images.length === 0) {
    return null;
  }

  return (
    <Group gap="xs" data-testid="image-thumbnails">
      {images.map((image, index) => {
        const picture = (
          <Image
            src={image.url}
            alt={image.label}
            w={size}
            h={size}
            fit="cover"
            radius="sm"
            style={{ border: '1px solid var(--border-default)' }}
          />
        );
        return (
          <Box key={image.id} pos="relative">
            {onOpen ? (
              <UnstyledButton onClick={() => onOpen(index)} aria-label={t('images.openNamed', { name: image.label })}>
                {picture}
              </UnstyledButton>
            ) : (
              picture
            )}
            {onRemove && (
              <ActionIcon
                size="sm"
                color="red"
                variant="filled"
                pos="absolute"
                top={4}
                right={4}
                onClick={() => onRemove(image.id)}
                aria-label={t('images.removeNamed', { name: image.label })}
              >
                <XIcon size={12} />
              </ActionIcon>
            )}
          </Box>
        );
      })}
    </Group>
  );
}
