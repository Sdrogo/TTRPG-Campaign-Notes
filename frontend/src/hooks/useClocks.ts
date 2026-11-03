import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '../lib/apiClient';
import { sectionsQueryKey } from './useLanding';
import {
  toClock,
  toCreateBody,
  toGroup,
  toHistory,
  toLabel,
  toMarkKind,
  toRules,
  toSettingsBody,
  toUpdateBody,
  type RawClock,
  type RawGroup,
  type RawHistory,
  type RawLabel,
  type RawMarkKind,
  type RawMarkResponse,
  type RawRules,
} from '../lib/clocks';
import type {
  Clock,
  ClockFormValues,
  ClockGroup,
  ClockRules,
  ClockSettings,
  GroupItem,
  GroupMode,
  KindWho,
  MarkPolicy,
  OpenPolicy,
} from '../types/clock';
import type { DocumentVisibility } from '../types/document';
import type { MapColor } from '../types/map';

function roomPath(roomId: string) {
  return `/rooms/${roomId}`;
}

/** Every clock query of a Room, so one event can refresh them all. */
export function clocksRootKey(roomId: string) {
  return ['rooms', roomId, 'clocks'] as const;
}

/** The Room's clocks the viewer sees, in the Clocks page's order. */
export function clocksQueryKey(roomId: string) {
  return [...clocksRootKey(roomId), 'list'] as const;
}

/** The Room's clock rules, labels, mark kinds and templates. */
export function clockRulesQueryKey(roomId: string) {
  return [...clocksRootKey(roomId), 'rules'] as const;
}

/** The Room's clock groups the viewer sees. */
export function clockGroupsQueryKey(roomId: string) {
  return [...clocksRootKey(roomId), 'groups'] as const;
}

function historyQueryKey(roomId: string, clockId: string) {
  return [...clocksRootKey(roomId), 'history', clockId] as const;
}

/** The Room's clocks the viewer sees (spec 61 Decision 15), in the page's order. */
export function useClocks(roomId: string, enabled = true) {
  return useQuery<Clock[]>({
    queryKey: clocksQueryKey(roomId),
    queryFn: async () => (await apiFetch<RawClock[]>(`${roomPath(roomId)}/clocks`)).map(toClock),
    enabled,
  });
}

/** The Room's clock rules (Decision 1), for every member. */
export function useClockRules(roomId: string, enabled = true) {
  return useQuery<ClockRules>({
    queryKey: clockRulesQueryKey(roomId),
    queryFn: async () => toRules(await apiFetch<RawRules>(`${roomPath(roomId)}/clock-rules`)),
    enabled,
  });
}

/** The Room's clock groups the viewer sees (Decision 11). */
export function useClockGroups(roomId: string, enabled = true) {
  return useQuery<ClockGroup[]>({
    queryKey: clockGroupsQueryKey(roomId),
    queryFn: async () =>
      (await apiFetch<RawGroup[]>(`${roomPath(roomId)}/clock-groups`)).map(toGroup),
    enabled,
  });
}

/** A clock's history (Decision 10), 50 lines a page, newest first. */
export function useClockHistory(roomId: string, clockId: string) {
  return useInfiniteQuery({
    queryKey: historyQueryKey(roomId, clockId),
    queryFn: async ({ pageParam }) => {
      const query = pageParam ? `?before=${encodeURIComponent(pageParam)}` : '';
      return toHistory(
        await apiFetch<RawHistory>(`${roomPath(roomId)}/clocks/${clockId}/history${query}`),
      );
    },
    initialPageParam: null as string | null,
    getNextPageParam: (page) => page.nextBefore,
  });
}

/** Puts a clock the server just answered into the list, in its place. */
function useStoreClock(roomId: string) {
  const queryClient = useQueryClient();
  return (clock: Clock) => {
    queryClient.setQueryData<Clock[]>(clocksQueryKey(roomId), (clocks) =>
      clocks?.map((other) => (other.id === clock.id ? clock : other)),
    );
  };
}

/** Reads every clock query of the Room again (lists, rules, groups, history). */
function useRefreshClocks(roomId: string) {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: clocksRootKey(roomId) });
}

/**
 * Opens a clock, or proposes one under "I giocatori propongono" (Decision
 * 13). The first clock also adds the Clocks card to the Room's home.
 */
export function useCreateClock(roomId: string) {
  const refresh = useRefreshClocks(roomId);
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (values: ClockFormValues) =>
      toClock(
        await apiFetch<RawClock>(`${roomPath(roomId)}/clocks`, {
          method: 'POST',
          json: toCreateBody(values),
        }),
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: sectionsQueryKey(roomId) });
      return refresh();
    },
  });
}

/** Saves a clock's dialog; 412 when someone changed it since it was loaded. */
export function useUpdateClock(roomId: string) {
  const store = useStoreClock(roomId);
  const refresh = useRefreshClocks(roomId);
  return useMutation({
    mutationFn: async ({ clock, values }: { clock: Clock; values: ClockFormValues }) =>
      toClock(
        await apiFetch<RawClock>(`${roomPath(roomId)}/clocks/${clock.id}`, {
          method: 'PATCH',
          json: toUpdateBody(values, clock.revision),
        }),
      ),
    onSuccess: (clock) => {
      store(clock);
      return refresh();
    },
  });
}

/** Archives or restores a clock (Decision 5). */
export function useArchiveClock(roomId: string) {
  const refresh = useRefreshClocks(roomId);
  return useMutation({
    mutationFn: ({ clockId, archived }: { clockId: string; archived: boolean }) =>
      apiFetch<RawClock>(`${roomPath(roomId)}/clocks/${clockId}`, {
        method: 'PATCH',
        json: { archived },
      }),
    onSuccess: () => refresh(),
  });
}

/** Deletes a clock with its history; a proposal's "Rifiuta" too (Decision 13). */
export function useDeleteClock(roomId: string) {
  const refresh = useRefreshClocks(roomId);
  return useMutation({
    mutationFn: (clockId: string) =>
      apiFetch<void>(`${roomPath(roomId)}/clocks/${clockId}`, { method: 'DELETE' }),
    onSuccess: () => refresh(),
  });
}

/** The Master opens a proposed clock (Decision 13). */
export function useOpenClock(roomId: string) {
  const refresh = useRefreshClocks(roomId);
  return useMutation({
    mutationFn: (clockId: string) =>
      apiFetch<RawClock>(`${roomPath(roomId)}/clocks/${clockId}/open`, { method: 'POST' }),
    onSuccess: () => refresh(),
  });
}

/** A mark as sent (Decision 9): a delta, negative to empty, with an optional kind and note. */
export interface MarkInput {
  clockId: string;
  delta: number;
  kindId?: string | null;
  note?: string | null;
}

/**
 * Marks a clock: one write per mark, as a delta the server clamps, so two
 * people marking at once both count (Decision 9). Answers the clock as it now
 * is and the mark's id, for the toast's "Annulla".
 */
export function useMarkClock(roomId: string) {
  const store = useStoreClock(roomId);
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ clockId, delta, kindId, note }: MarkInput) => {
      const raw = await apiFetch<RawMarkResponse>(`${roomPath(roomId)}/clocks/${clockId}/marks`, {
        method: 'POST',
        json: { delta, kind_id: kindId ?? null, note: note?.trim() || null },
      });
      return { clock: toClock(raw.clock), markId: raw.mark_id };
    },
    onSuccess: ({ clock }) => {
      store(clock);
      // A close can change a group's pending clocks.
      void queryClient.invalidateQueries({ queryKey: clockGroupsQueryKey(roomId) });
      void queryClient.invalidateQueries({ queryKey: historyQueryKey(roomId, clock.id) });
    },
  });
}

/** Takes back a mark just made (the toast's "Annulla", Decision 9). */
export function useUndoMark(roomId: string) {
  const store = useStoreClock(roomId);
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ clockId, markId }: { clockId: string; markId: string }) =>
      toClock(
        (
          await apiFetch<RawMarkResponse>(
            `${roomPath(roomId)}/clocks/${clockId}/marks/${markId}/undo`,
            { method: 'POST' },
          )
        ).clock,
      ),
    onSuccess: (clock) => {
      store(clock);
      void queryClient.invalidateQueries({ queryKey: clockGroupsQueryKey(roomId) });
      void queryClient.invalidateQueries({ queryKey: historyQueryKey(roomId, clock.id) });
    },
  });
}

/** The Master saves the clocks' order on the page (every clock, once). */
export function useReorderClocks(roomId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (ids: string[]) =>
      apiFetch<void>(`${roomPath(roomId)}/clocks-order`, { method: 'PUT', json: { ids } }),
    onMutate: (ids) => {
      queryClient.setQueryData<Clock[]>(clocksQueryKey(roomId), (clocks) =>
        clocks ? ids.flatMap((id) => clocks.filter((clock) => clock.id === id)) : clocks,
      );
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: clocksQueryKey(roomId) }),
  });
}

// --- Rules (Master) -----------------------------------------------------------

/** The three policies of the rules dialog. */
export interface PoliciesInput {
  openPolicy: OpenPolicy;
  markPolicy: MarkPolicy;
  allowUnmark: boolean;
}

/** Saves the Room's three policies; the first save adds the Clocks card to the home. */
export function useSaveClockPolicies(roomId: string) {
  const refresh = useRefreshClocks(roomId);
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: PoliciesInput) =>
      toRules(
        await apiFetch<RawRules>(`${roomPath(roomId)}/clock-rules`, {
          method: 'PUT',
          json: {
            open_policy: input.openPolicy,
            mark_policy: input.markPolicy,
            allow_unmark: input.allowUnmark,
          },
        }),
      ),
    onSuccess: (rules) => {
      queryClient.setQueryData(clockRulesQueryKey(roomId), rules);
      void queryClient.invalidateQueries({ queryKey: sectionsQueryKey(roomId) });
      return refresh();
    },
  });
}

/** A label's or a mark kind's fields; a kind adds who may use it. */
export interface RuleItemInput {
  name: string;
  color: MapColor;
  who?: KindWho;
}

/** Creates a Room label (the rules dialog, or "Crea «…»" in a clock's picker). */
export function useCreateLabel(roomId: string) {
  const refresh = useRefreshClocks(roomId);
  return useMutation({
    mutationFn: async ({ name, color }: RuleItemInput) =>
      toLabel(
        await apiFetch<RawLabel>(`${roomPath(roomId)}/clock-rules/labels`, {
          method: 'POST',
          json: { name: name.trim(), color },
        }),
      ),
    onSuccess: () => refresh(),
  });
}

/** Renames or recolours a label. */
export function useUpdateLabel(roomId: string) {
  const refresh = useRefreshClocks(roomId);
  return useMutation({
    mutationFn: ({ id, ...input }: RuleItemInput & { id: string }) =>
      apiFetch<RawLabel>(`${roomPath(roomId)}/clock-rules/labels/${id}`, {
        method: 'PATCH',
        json: { name: input.name.trim(), color: input.color },
      }),
    onSuccess: () => refresh(),
  });
}

/** Deletes a label, taking it off its clocks. */
export function useDeleteLabel(roomId: string) {
  const refresh = useRefreshClocks(roomId);
  return useMutation({
    mutationFn: (id: string) =>
      apiFetch<void>(`${roomPath(roomId)}/clock-rules/labels/${id}`, { method: 'DELETE' }),
    onSuccess: () => refresh(),
  });
}

/** Creates a mark kind. */
export function useCreateMarkKind(roomId: string) {
  const refresh = useRefreshClocks(roomId);
  return useMutation({
    mutationFn: async ({ name, color, who }: RuleItemInput) =>
      toMarkKind(
        await apiFetch<RawMarkKind>(`${roomPath(roomId)}/clock-rules/mark-kinds`, {
          method: 'POST',
          json: { name: name.trim(), color, who: who ?? 'everyone' },
        }),
      ),
    onSuccess: () => refresh(),
  });
}

/** Renames, recolours a mark kind or changes who may use it. */
export function useUpdateMarkKind(roomId: string) {
  const refresh = useRefreshClocks(roomId);
  return useMutation({
    mutationFn: ({ id, ...input }: RuleItemInput & { id: string }) =>
      apiFetch<RawMarkKind>(`${roomPath(roomId)}/clock-rules/mark-kinds/${id}`, {
        method: 'PATCH',
        json: { name: input.name.trim(), color: input.color, who: input.who },
      }),
    onSuccess: () => refresh(),
  });
}

/** Deletes a mark kind; its past marks take the clock's colour. */
export function useDeleteMarkKind(roomId: string) {
  const refresh = useRefreshClocks(roomId);
  return useMutation({
    mutationFn: (id: string) =>
      apiFetch<void>(`${roomPath(roomId)}/clock-rules/mark-kinds/${id}`, { method: 'DELETE' }),
    onSuccess: () => refresh(),
  });
}

/** Saves a clock's settings as a Room template ("Salva come modello", Decision 3). */
export function useCreateTemplate(roomId: string) {
  const refresh = useRefreshClocks(roomId);
  return useMutation({
    mutationFn: ({ name, settings }: { name: string; settings: ClockSettings }) =>
      apiFetch<unknown>(`${roomPath(roomId)}/clock-rules/templates`, {
        method: 'POST',
        json: { name: name.trim(), settings: toSettingsBody(settings) },
      }),
    onSuccess: () => refresh(),
  });
}

/** Deletes a Room template. */
export function useDeleteTemplate(roomId: string) {
  const refresh = useRefreshClocks(roomId);
  return useMutation({
    mutationFn: (id: string) =>
      apiFetch<void>(`${roomPath(roomId)}/clock-rules/templates/${id}`, { method: 'DELETE' }),
    onSuccess: () => refresh(),
  });
}

// --- Groups (Master) ------------------------------------------------------------

/** The group dialog's answer: a new group (no id) or an existing one, and its clocks in order. */
export interface GroupInput {
  groupId: string | null;
  name: string;
  mode: GroupMode;
  items: GroupItem[];
}

/**
 * Saves a group (spec 61 Decision 11): creates it or renames it and sets its
 * mode, then puts its clocks in order (a clock in another group moves here).
 */
export function useSaveGroup(roomId: string) {
  const refresh = useRefreshClocks(roomId);
  return useMutation({
    mutationFn: async ({ groupId, name, mode, items }: GroupInput) => {
      const id = groupId
        ? (
            await apiFetch<RawGroup>(`${roomPath(roomId)}/clock-groups/${groupId}`, {
              method: 'PATCH',
              json: { name: name.trim(), mode },
            })
          ).id
        : (
            await apiFetch<RawGroup>(`${roomPath(roomId)}/clock-groups`, {
              method: 'POST',
              json: { name: name.trim(), mode },
            })
          ).id;
      return toGroup(
        await apiFetch<RawGroup>(`${roomPath(roomId)}/clock-groups/${id}/clocks`, {
          method: 'PUT',
          json: {
            items: items.map((item) => ({
              clock_id: item.clockId,
              decisive_label: mode === 'turn' ? item.decisiveLabel?.trim() || null : null,
            })),
          },
        }),
      );
    },
    onSuccess: () => refresh(),
  });
}

/** Archives or restores every clock of a group (Decision 12). */
export function useArchiveGroup(roomId: string) {
  const refresh = useRefreshClocks(roomId);
  return useMutation({
    mutationFn: ({ groupId, archived }: { groupId: string; archived: boolean }) =>
      apiFetch<RawGroup>(`${roomPath(roomId)}/clock-groups/${groupId}`, {
        method: 'PATCH',
        json: { archived },
      }),
    onSuccess: () => refresh(),
  });
}

/** Deletes a group; its clocks stay, outside any group. */
export function useDeleteGroup(roomId: string) {
  const refresh = useRefreshClocks(roomId);
  return useMutation({
    mutationFn: (groupId: string) =>
      apiFetch<void>(`${roomPath(roomId)}/clock-groups/${groupId}`, { method: 'DELETE' }),
    onSuccess: () => refresh(),
  });
}

/** Confirms a race ("Conferma") or ends a turn ("Termina la svolta"), Decision 11. */
export function useEndGroup(roomId: string) {
  const refresh = useRefreshClocks(roomId);
  return useMutation({
    mutationFn: (groupId: string) =>
      apiFetch<unknown>(`${roomPath(roomId)}/clock-groups/${groupId}/end`, { method: 'POST' }),
    onSuccess: () => refresh(),
  });
}

/** Shows a clock to more members: a sequence's next clock, revealed by the Master (audited). */
export function useRevealClock(roomId: string) {
  const refresh = useRefreshClocks(roomId);
  return useMutation({
    mutationFn: ({ clockId, visibility }: { clockId: string; visibility: DocumentVisibility }) =>
      apiFetch<RawClock>(`${roomPath(roomId)}/clocks/${clockId}`, {
        method: 'PATCH',
        json: { visibility },
      }),
    onSuccess: () => refresh(),
  });
}
