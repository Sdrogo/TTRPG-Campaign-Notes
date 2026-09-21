import { notifications } from '@mantine/notifications';

export function notifyError(error: unknown) {
  notifications.show({
    color: 'red',
    message: error instanceof Error ? error.message : String(error),
  });
}
