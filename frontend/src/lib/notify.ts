import { notifications } from '@mantine/notifications';

/** Shows an error toast with the error's message - an `ApiError` carries the backend's `detail`. */
export function notifyError(error: unknown) {
  notifications.show({
    color: 'red',
    message: error instanceof Error ? error.message : String(error),
  });
}

/** Shows a success toast. */
export function notifySuccess(message: string) {
  notifications.show({ color: 'var(--state-success)', message });
}
