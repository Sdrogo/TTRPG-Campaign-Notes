import type { ReactNode } from 'react';
import { Card } from '@mantine/core';

/**
 * The main card of a page: full width inside PageLayout's margins, so it's
 * centered horizontally and grows with the screen, with padding that grows too.
 * Shared by the Document, Comments and Account cards.
 */
export function PageCard({ children }: { children: ReactNode }) {
  return (
    <Card withBorder radius="md" w="100%" p={{ base: 'md', sm: 'lg', lg: 'xl' }}>
      {children}
    </Card>
  );
}
