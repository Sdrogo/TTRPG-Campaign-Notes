import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FullPageLoader, FullPageMessage } from '../components/PageState';
import { DEMO_START_PATH, setDemoMode } from '../lib/demo/demoMode';

/**
 * `/demo` (spec 45_2): turns the Demo on for this tab and opens the sample
 * Room with a full page load, so nothing cached from a real session mixes
 * with it. Without site storage the Demo cannot start, and the page says so.
 */
export function DemoPage() {
  const { t } = useTranslation();
  // Turned on during the first render: the flag is the only state, and a
  // page that cannot store it says so instead of loading.
  const [started] = useState(() => setDemoMode(true));

  useEffect(() => {
    if (started) window.location.replace(DEMO_START_PATH);
  }, [started]);

  if (!started) {
    return (
      <FullPageMessage actionLabel={t('common.back')} actionTo="/">
        {t('demo.unavailable')}
      </FullPageMessage>
    );
  }
  return <FullPageLoader />;
}
