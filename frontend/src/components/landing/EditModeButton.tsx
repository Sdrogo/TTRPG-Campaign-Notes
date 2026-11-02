import { Button } from '@mantine/core';
import { CheckIcon, PencilSimpleIcon } from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';

/**
 * The Master's "Modifica" beside a landing or Section title (spec 55
 * Decision 11): edit mode changes no layout, only adds handles; every
 * change is saved as it is made, and "Fine" leaves it.
 */
export function EditModeButton({ editing, onChange }: { editing: boolean; onChange: (editing: boolean) => void }) {
  const { t } = useTranslation();
  return (
    <Button
      size="xs"
      variant={editing ? 'filled' : 'light'}
      leftSection={editing ? <CheckIcon size={14} /> : <PencilSimpleIcon size={14} />}
      onClick={() => onChange(!editing)}
      aria-pressed={editing}
    >
      {editing ? t('roomLanding.edit.done') : t('roomLanding.edit.start')}
    </Button>
  );
}
