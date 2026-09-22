import { notifications } from '@mantine/notifications';

export function notifyError(error: unknown) {
  notifications.show({
    color: 'red',
    message: error instanceof Error ? error.message : String(error),
  });
}

export function notifySuccess(message: string) {
  notifications.show({ color: 'var(--state-success)', message });
}
