import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { MantineProvider } from '@mantine/core';
import { Notifications } from '@mantine/notifications';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter } from 'react-router-dom';

import '@fontsource/inter/400.css';
import '@fontsource/inter/500.css';
import '@fontsource/inter/600.css';
import '@fontsource/eb-garamond/400.css';
import '@fontsource/eb-garamond/500.css';
import '@fontsource/jetbrains-mono/400.css';

import '@mantine/core/styles.css';
import '@mantine/notifications/styles.css';
import '@mantine/carousel/styles.css';
import './theme/tokens.css';
import './index.css';

// Initializes i18next, and the first render waits for the starting language's
// strings (a language that isn't bundled is fetched), so every component has them.
import { i18nReady } from './i18n';
import { theme } from './theme/theme';
import { applyPalette, readStoredPalette } from './lib/palette';
import App from './App.tsx';

const queryClient = new QueryClient();

// The map palette last used in this browser (spec 78), before the first paint;
// the account's own choice replaces it once it loads (`useAccount`).
applyPalette(readStoredPalette());

void i18nReady.then(() => {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <MantineProvider theme={theme} forceColorScheme="dark">
        <Notifications />
        <QueryClientProvider client={queryClient}>
          <BrowserRouter>
            <App />
          </BrowserRouter>
        </QueryClientProvider>
      </MantineProvider>
    </StrictMode>,
  );
});
