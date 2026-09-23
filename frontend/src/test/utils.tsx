import type { ReactElement, ReactNode } from 'react';
import { MantineProvider } from '@mantine/core';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, renderHook } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { theme } from '../theme/theme';

// Retries turn a deliberate 500 into a multi-second test, and the cache has
// to start empty for every test or one test's data leaks into the next.
export function createTestQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0, staleTime: 0 },
      mutations: { retry: false },
    },
  });
}

interface WrapperOptions {
  queryClient?: QueryClient;
  // Initial history entries, for components that read route params or links.
  route?: string;
  // An extra provider to nest inside the standard ones - for a component or
  // hook that needs app context of its own (e.g. DocumentMentionsProvider).
  wrapper?: (props: { children: ReactNode }) => ReactElement;
}

// Fast refresh doesn't apply to a test-only helper module.
// eslint-disable-next-line react/only-export-components
function Providers({
  children,
  queryClient,
  route = '/',
  wrapper: Inner,
}: WrapperOptions & { children: ReactNode }) {
  return (
    <MantineProvider theme={theme} forceColorScheme="dark" env="test">
      <QueryClientProvider client={queryClient ?? createTestQueryClient()}>
        <MemoryRouter initialEntries={[route]}>
          {Inner ? <Inner>{children}</Inner> : children}
        </MemoryRouter>
      </QueryClientProvider>
    </MantineProvider>
  );
}

// The same provider stack as `main.tsx`, so a component under test sees the
// theme, the query cache and the router it sees in the running app.
export function renderWithProviders(ui: ReactElement, options: WrapperOptions = {}) {
  const queryClient = options.queryClient ?? createTestQueryClient();
  return {
    queryClient,
    ...render(ui, {
      wrapper: ({ children }) => (
        <Providers queryClient={queryClient} route={options.route} wrapper={options.wrapper}>
          {children}
        </Providers>
      ),
    }),
  };
}

export function renderHookWithProviders<Result>(
  hook: () => Result,
  options: WrapperOptions = {},
) {
  const queryClient = options.queryClient ?? createTestQueryClient();
  return {
    queryClient,
    ...renderHook(hook, {
      wrapper: ({ children }) => (
        <Providers queryClient={queryClient} route={options.route} wrapper={options.wrapper}>
          {children}
        </Providers>
      ),
    }),
  };
}
