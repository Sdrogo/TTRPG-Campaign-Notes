import type { LinesVeilsKind, ModuleKind, SessionZeroOverview } from '../types/sessionZero';
import { toDdi, toPoll, toQuestions, toRound, type RawDdi, type RawPoll, type RawQuestions, type RawRound } from './sessionZero';

/** `GET /rooms/{id}/session-zero/overview` on the wire. */
export interface RawSessionZeroOverview {
  started: boolean;
  rounds: (RawRound & {
    steps: {
      id: string;
      kind: ModuleKind;
      position: number;
      cards: number;
      questions?: RawQuestions | null;
      ddi?: RawDdi | null;
      polls?: RawPoll[] | null;
    }[];
  })[];
  lines_veils: Partial<Record<LinesVeilsKind, number>>;
}

/** The overview's model, from the backend's snake_case answer. */
export function toSessionZeroOverview(raw: RawSessionZeroOverview): SessionZeroOverview {
  return {
    started: raw.started,
    rounds: raw.rounds.map((round) => ({
      ...toRound(round),
      steps: round.steps.map((step) => ({
        id: step.id,
        kind: step.kind,
        position: step.position,
        cards: step.cards,
        ...(step.questions ? { questions: toQuestions(step.questions) } : {}),
        ...(step.ddi ? { ddi: toDdi(step.ddi) } : {}),
        ...(step.polls ? { polls: step.polls.map(toPoll) } : {}),
      })),
    })),
    linesVeils: raw.lines_veils,
  };
}
