import { Box } from '@mantine/core';
import { Carousel } from '@mantine/carousel';
import type { DocumentImage } from '../types/document';

// Half the card's width (spec 07), so this stays short enough that the
// description beside it still reads as the main content.
const CARD_IMAGE_HEIGHT = { base: 120, sm: 140 };

// The whole card is a link (see `DocumentCard`), which sits above the images
// so clicking one opens the Document. The carousel's own controls have to
// come back out on top of it, or they'd just navigate too.
const ABOVE_CARD_LINK = 2;

interface DocumentCardImagesProps {
  images: DocumentImage[];
  documentName: string;
}

/** The Document's images on its card, favorite first. Read-only: managing
 *  them (adding, deleting, moving the favorite) stays on the detail page. */
export function DocumentCardImages({ images, documentName }: DocumentCardImagesProps) {
  if (images.length === 0) {
    return null;
  }

  if (images.length === 1) {
    return <CardImage image={images[0]} alt={documentName} />;
  }

  return (
    <Box h={CARD_IMAGE_HEIGHT}>
      <Carousel
        height="100%"
        withIndicators
        // Dragging would fight the card's link overlay, so the arrows - kept
        // visible rather than shown on hover, since a touch screen has none -
        // are the way through the images.
        emblaOptions={{ loop: true, watchDrag: false }}
        styles={{
          controls: { zIndex: ABOVE_CARD_LINK, opacity: 1 },
          indicators: { zIndex: ABOVE_CARD_LINK },
          indicator: { width: 10, height: 3 },
        }}
      >
        {images.map((image, index) => (
          <Carousel.Slide key={image.id}>
            <CardImage image={image} alt={`${documentName} (${index + 1})`} />
          </Carousel.Slide>
        ))}
      </Carousel>
    </Box>
  );
}

function CardImage({ image, alt }: { image: DocumentImage; alt: string }) {
  return (
    <Box
      h={CARD_IMAGE_HEIGHT}
      bg="var(--bg-base)"
      style={{ borderRadius: 'var(--mantine-radius-sm)', overflow: 'hidden' }}
    >
      <img
        src={image.url}
        alt={alt}
        loading="lazy"
        draggable={false}
        style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
      />
    </Box>
  );
}
