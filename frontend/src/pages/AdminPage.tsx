import type { ReactNode } from 'react';
import { Badge, Group, SimpleGrid, Stack, Table, Text } from '@mantine/core';
import { useTranslation } from 'react-i18next';
import { useSession } from '../hooks/useSession';
import { useAccount } from '../hooks/useAccount';
import { useAdminStats } from '../hooks/useAdminStats';
import { currentLanguage } from '../i18n';
import { formatFileSize } from '../lib/documentFiles';
import { FullPageLoader, FullPageMessage, SignInRequired } from '../components/PageState';
import { PageLayout } from '../components/PageLayout';
import { PageHeading } from '../components/PageHeading';
import { AccountSection } from '../components/account/AccountSection';
import { BarChart } from '../components/admin/BarChart';
import type { AdminJobCounts, AdminStats } from '../types/admin';

/**
 * `/admin`: the app's numbers for the product owner (ticket 75 Decision 7):
 * users, Rooms and content counts, growth per week, the API's traffic and
 * timings, the latest server errors and the background jobs. Only for users
 * listed in the backend's `ADMIN_USER_IDS`; everyone else sees "not
 * available", as for a page that doesn't exist. Counts only, never content.
 */
export function AdminPage() {
  const { t } = useTranslation();
  const { session, loading } = useSession();

  if (loading) {
    return <FullPageLoader />;
  }
  if (!session) {
    return <SignInRequired>{t('admin.signInRequired')}</SignInRequired>;
  }
  return <AdminLoader />;
}

function AdminLoader() {
  const { t } = useTranslation();
  const account = useAccount(true);
  const allowed = account.data?.appAdmin === true;
  const stats = useAdminStats(allowed);

  if (account.isLoading || (allowed && stats.isLoading)) {
    return <FullPageLoader />;
  }
  if (!allowed) {
    return (
      <FullPageMessage actionLabel={t('common.backToMyRooms')} actionTo="/rooms">
        {t('admin.notAvailable')}
      </FullPageMessage>
    );
  }
  if (!stats.data) {
    return (
      <FullPageMessage actionLabel={t('common.backToMyRooms')} actionTo="/rooms">
        {t('admin.loadError')}
      </FullPageMessage>
    );
  }
  return <AdminContent stats={stats.data} />;
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat(currentLanguage()).format(value);
}

function formatTime(iso: string, withTime = true): string {
  const options: Intl.DateTimeFormatOptions = withTime
    ? { dateStyle: 'short', timeStyle: 'short' }
    : { dateStyle: 'short' };
  return new Intl.DateTimeFormat(currentLanguage(), options).format(new Date(iso));
}

function formatMs(value: number | null): string {
  return value === null ? '–' : `≤ ${formatNumber(value)} ms`;
}

function Stat({ label, value, hint }: { label: string; value: ReactNode; hint?: string }) {
  return (
    <Stack gap={0}>
      <Text size="sm" c="dimmed">
        {label}
      </Text>
      <Text fz="xl" fw={600}>
        {value}
      </Text>
      {hint && (
        <Text size="xs" c="dimmed">
          {hint}
        </Text>
      )}
    </Stack>
  );
}

function AdminContent({ stats }: { stats: AdminStats }) {
  const { t } = useTranslation();
  const { overview, traffic } = stats;
  const providers = Object.entries(overview.sign_ins_by_provider)
    .map(([provider, count]) => `${provider} ${formatNumber(count)}`)
    .join(' · ');

  return (
    <PageLayout backTo="/account" backLabel={t('account.title')}>
      <PageHeading
        title={t('admin.title')}
        description={t('admin.subtitle', { time: formatTime(stats.generated_at) })}
      />

      <AccountSection title={t('admin.overview.title')}>
        <SimpleGrid cols={{ base: 2, sm: 3, lg: 4 }} spacing="lg">
          <Stat
            label={t('admin.overview.users')}
            value={formatNumber(overview.users)}
            hint={providers || undefined}
          />
          <Stat
            label={t('admin.overview.newUsers')}
            value={`${formatNumber(overview.new_users_7d)} / ${formatNumber(overview.new_users_30d)}`}
            hint={t('admin.overview.last7and30')}
          />
          <Stat
            label={t('admin.overview.activeUsers')}
            value={`${formatNumber(overview.active_users_7d)} / ${formatNumber(overview.active_users_30d)}`}
            hint={t('admin.overview.last7and30')}
          />
          <Stat label={t('admin.overview.rooms')} value={formatNumber(overview.rooms)} />
          <Stat label={t('admin.overview.documents')} value={formatNumber(overview.documents)} />
          <Stat
            label={t('admin.overview.maps')}
            value={formatNumber(overview.maps + overview.geographic_maps)}
            hint={t('admin.overview.geographic', { value: formatNumber(overview.geographic_maps) })}
          />
          <Stat label={t('admin.overview.sessionZeros')} value={formatNumber(overview.session_zeros)} />
          <Stat label={t('admin.overview.clocks')} value={formatNumber(overview.clocks)} />
          <Stat
            label={t('admin.overview.files')}
            value={formatNumber(overview.files)}
            hint={formatFileSize(overview.files_bytes)}
          />
          <Stat label={t('admin.overview.images')} value={formatNumber(overview.images)} />
          <Stat label={t('admin.overview.database')} value={formatFileSize(overview.database_bytes)} />
        </SimpleGrid>
      </AccountSection>

      <AccountSection title={t('admin.growth.title')} description={t('admin.growth.description')}>
        <SimpleGrid cols={{ base: 1, md: 2 }} spacing="xl">
          <Stack gap="xs">
            <Text size="sm" fw={500}>
              {t('admin.growth.newUsers')}
            </Text>
            <BarChart
              title={t('admin.growth.newUsers')}
              bars={stats.growth.map((week) => ({ label: formatTime(week.week, false), value: week.new_users }))}
            />
          </Stack>
          <Stack gap="xs">
            <Text size="sm" fw={500}>
              {t('admin.growth.newRooms')}
            </Text>
            <BarChart
              title={t('admin.growth.newRooms')}
              bars={stats.growth.map((week) => ({ label: formatTime(week.week, false), value: week.new_rooms }))}
              color="var(--mantine-color-teal-6)"
            />
          </Stack>
        </SimpleGrid>
      </AccountSection>

      <AccountSection
        title={t('admin.traffic.title')}
        description={t('admin.traffic.description', { days: traffic.days })}
      >
        <Stack gap="xs">
          <Text size="sm" fw={500}>
            {t('admin.traffic.perHour')}
          </Text>
          <BarChart
            title={t('admin.traffic.perHour')}
            bars={traffic.hours.map((hour) => ({ label: formatTime(hour.hour), value: hour.requests }))}
          />
        </Stack>
        {traffic.groups.length === 0 ? (
          <Text size="sm" c="dimmed">
            {t('admin.traffic.empty')}
          </Text>
        ) : (
          <Table.ScrollContainer minWidth={560}>
            <Table striped>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>{t('admin.traffic.group')}</Table.Th>
                  <Table.Th ta="right">{t('admin.traffic.requests')}</Table.Th>
                  <Table.Th ta="right">{t('admin.traffic.clientErrors')}</Table.Th>
                  <Table.Th ta="right">{t('admin.traffic.serverErrors')}</Table.Th>
                  <Table.Th ta="right">{t('admin.traffic.median')}</Table.Th>
                  <Table.Th ta="right">{t('admin.traffic.p95')}</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {traffic.groups.map((group) => (
                  <Table.Tr key={group.group}>
                    <Table.Td>
                      <Text ff="monospace" size="sm">
                        {group.group}
                      </Text>
                    </Table.Td>
                    <Table.Td ta="right">{formatNumber(group.requests)}</Table.Td>
                    <Table.Td ta="right">{formatNumber(group.client_errors)}</Table.Td>
                    <Table.Td ta="right" c={group.server_errors > 0 ? 'red' : undefined}>
                      {formatNumber(group.server_errors)}
                    </Table.Td>
                    <Table.Td ta="right">{formatMs(group.p50_ms)}</Table.Td>
                    <Table.Td ta="right">{formatMs(group.p95_ms)}</Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </Table.ScrollContainer>
        )}
      </AccountSection>

      <AccountSection title={t('admin.errors.title')} description={t('admin.errors.description')}>
        {stats.errors.length === 0 ? (
          <Text size="sm" c="dimmed">
            {t('admin.errors.empty')}
          </Text>
        ) : (
          <Table.ScrollContainer minWidth={640}>
            <Table striped>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>{t('admin.errors.time')}</Table.Th>
                  <Table.Th>{t('admin.errors.route')}</Table.Th>
                  <Table.Th>{t('admin.errors.status')}</Table.Th>
                  <Table.Th>{t('admin.errors.type')}</Table.Th>
                  <Table.Th>{t('admin.errors.requestId')}</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {stats.errors.map((error) => (
                  <Table.Tr key={error.request_id}>
                    <Table.Td>{formatTime(error.occurred_at)}</Table.Td>
                    <Table.Td>
                      <Text ff="monospace" size="sm">
                        {error.method} {error.route}
                      </Text>
                    </Table.Td>
                    <Table.Td>{error.status}</Table.Td>
                    <Table.Td>{error.exc_type ?? '–'}</Table.Td>
                    <Table.Td>
                      <Text ff="monospace" size="sm">
                        {error.request_id}
                      </Text>
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </Table.ScrollContainer>
        )}
      </AccountSection>

      <AccountSection title={t('admin.jobs.title')}>
        <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="lg">
          <Jobs label={t('admin.jobs.exports')} counts={stats.jobs.exports} />
          <Jobs label={t('admin.jobs.imports')} counts={stats.jobs.imports} />
        </SimpleGrid>
      </AccountSection>
    </PageLayout>
  );
}

function Jobs({ label, counts }: { label: string; counts: AdminJobCounts }) {
  const { t } = useTranslation();
  return (
    <Stack gap={4}>
      <Text fw={500}>{label}</Text>
      <Group gap="xs">
        <Badge variant="light">{t('admin.jobs.running', { value: formatNumber(counts.running) })}</Badge>
        <Badge variant="light" color="teal">
          {t('admin.jobs.done', { value: formatNumber(counts.done_7d) })}
        </Badge>
        <Badge variant="light" color={counts.failed_7d > 0 ? 'red' : 'gray'}>
          {t('admin.jobs.failed', { value: formatNumber(counts.failed_7d) })}
        </Badge>
      </Group>
    </Stack>
  );
}
