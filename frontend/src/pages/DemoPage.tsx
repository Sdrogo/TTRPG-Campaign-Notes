import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FullPageLoader, FullPageMessage } from '../components/PageState';
import { useLocation } from 'react-router-dom';
import { setDemoMode } from '../lib/demo/demoMode';
import { TOUR_STEPS, setTourStep, stepIndex } from '../lib/demo/tour';

/**
 * `/demo` (spec 45_2): turns the Demo on for this tab and opens the sample
 * Room with a full page load, so nothing cached from a real session mixes
 * with it, and opens the guided tour (spec 45_3). Without site storage the
 * Demo cannot start, and the page says so.
 */
export function DemoPage() {
  const { t } = useTranslation();
  // Turned on during the first render: the flag is the only state, and a
  // page that cannot store it says so instead of loading.
  const [started] = useState(() => setDemoMode(true));

  // The tour opens on its own, at the step a landing page link names
  // (`/demo?step=maps`), else at the start.
  const { search } = useLocation();
  const step = new URLSearchParams(search).get('step');
  useEffect(() => {
    if (!started) return;
    const index = stepIndex(step);
    setTourStep(index);
    window.location.replace(TOUR_STEPS[index].path);
  }, [started, step]);

  if (!started) {
    return (
      <FullPageMessage actionLabel={t('common.back')} actionTo="/">
        {t('demo.unavailable')}
      </FullPageMessage>
    );
  }
  return <FullPageLoader />;
}
