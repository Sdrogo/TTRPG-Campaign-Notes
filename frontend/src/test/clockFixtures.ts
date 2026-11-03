import type { RawClock, RawGroup, RawRules } from '../lib/clocks';

/** A clock as the server sends it: "Allarme", 4/8, open, red, markable by the viewer. */
export function rawClock(overrides: Partial<RawClock> = {}): RawClock {
  return {
    id: 'clock-1',
    room_id: 'room-1',
    name: 'Allarme',
    description: '',
    segments: 8,
    filled: 4,
    color: 'red',
    stage_labels: [],
    closing_condition: null,
    consequence: null,
    forward_only: false,
    mark_policy: null,
    label_ids: [],
    state: 'open',
    archived: false,
    group_id: null,
    group_position: null,
    decisive_label: null,
    document: null,
    segment_kinds: [null, null, null, null],
    visibility: 'room',
    selective_user_ids: null,
    created_by: 'user-1',
    created_at: '2026-11-03T10:00:00Z',
    updated_at: '2026-11-03T10:00:00Z',
    revision: 3,
    locked: false,
    can_manage: true,
    can_mark: true,
    can_unmark: true,
    ...overrides,
  };
}

/** The Room's rules: the default policies, one label, two mark kinds, one template. */
export function rawRules(overrides: Partial<RawRules> = {}): RawRules {
  return {
    open_policy: 'master',
    mark_policy: 'master',
    allow_unmark: true,
    labels: [{ id: 'label-1', name: 'Jazz', color: 'violet', position: 0, clock_count: 2 }],
    mark_kinds: [
      { id: 'kind-1', name: 'Successo', color: 'green', who: 'players', position: 0 },
      { id: 'kind-2', name: 'Shock', color: 'red', who: 'master', position: 1 },
    ],
    templates: [
      {
        id: 'template-1',
        name: 'Bomba',
        position: 0,
        settings: {
          description: '',
          segments: 8,
          color: 'emerald',
          stage_labels: [],
          closing_condition: null,
          consequence: 'Boom',
          forward_only: false,
          mark_policy: null,
          label_ids: ['label-1', 'label-gone'],
        },
      },
    ],
    ...overrides,
  };
}

/** A race group holding `clock-1`. */
export function rawGroup(overrides: Partial<RawGroup> = {}): RawGroup {
  return {
    id: 'group-1',
    name: 'Fuga',
    mode: 'race',
    position: 0,
    clock_ids: ['clock-1'],
    ended: false,
    result: null,
    pending_ids: [],
    revision: 0,
    ...overrides,
  };
}
