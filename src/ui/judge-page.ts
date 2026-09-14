import { resolveJudgeHeat, type ManualPick } from "../core/resolve-judge-heat";
import { formatScore, validateScore, type Score } from "../core/score";
import { buildSubmission, type Submission } from "../core/submission";
import type { Event, Schedule } from "../core/types";
import { loadJudgeName, loadQueue, loadSentHeats, markHeatSent, saveJudgeName } from "./judge-store";
import { emptyDraft, readDraft, renderJudge, type Notice, type ScoreDraft } from "./render-judge";
import { postScore } from "./score-client";
import { enqueue, flush, type FlushOutcome } from "./submit-queue";

export type JudgePageOptions = {
  readonly root: HTMLElement;
  readonly schedule: Schedule;
  readonly event: Event;
  readonly lane: number;
  readonly endpoint: string;
  readonly now: () => Date;
  readonly fetchFn: typeof fetch;
  readonly newClientId: () => string;
};

export type JudgePage = { readonly tick: () => Promise<void> };

type PageState = {
  readonly manual: ManualPick | undefined;
  readonly draft: ScoreDraft | undefined;
  readonly notice: Notice | undefined;
};

const INITIAL: PageState = { manual: undefined, draft: undefined, notice: undefined };

const noticeAfterFlush = (outcome: FlushOutcome, current: Notice | undefined): Notice | undefined => {
  const rejection = outcome.rejected[0];
  if (rejection) return { kind: "error", text: rejection.error };
  if (outcome.pending > 0) return { kind: "retrying" };
  return current?.kind === "retrying" ? undefined : current;
};

const isTypingIn = (root: HTMLElement): boolean =>
  document.activeElement instanceof HTMLInputElement && root.contains(document.activeElement);

export const startJudgePage = (options: JudgePageOptions): JudgePage => {
  const { root, schedule, event, lane, endpoint, now, fetchFn, newClientId } = options;
  let state: PageState = INITIAL;

  const post = (submission: Submission) => postScore({ endpoint, submission, fetchFn });

  const commit = (next: PageState): void => {
    state = next;
  };

  const render = (): void =>
    renderJudge({
      root,
      schedule,
      event,
      lane,
      now: now(),
      judgeName: loadJudgeName(),
      sentHeats: loadSentHeats({ event: event.number, lane }),
      manual: state.manual,
      draft: state.draft,
      pending: loadQueue().length,
      notice: state.notice,
      endpointConfigured: endpoint !== "",
      onNameSubmit: (name) => {
        saveJudgeName(name);
        draw(state);
      },
      onNameClear: () => {
        saveJudgeName(undefined);
        draw({ ...state, draft: undefined, notice: undefined });
      },
      onHeatChange: (heat) => draw({ manual: { heat, at: now() }, draft: undefined, notice: undefined }),
      onModeChange: (mode) => draw({ ...state, draft: { ...readDraft(root, state.draft ?? emptyDraft(event)), mode } }),
      onSubmit: (score) => void submit(score),
    });

  const draw = (next: PageState): void => {
    commit(next);
    render();
  };

  const currentDraft = (): ScoreDraft | undefined =>
    loadJudgeName() ? readDraft(root, state.draft ?? emptyDraft(event)) : undefined;

  const settled = async (): Promise<PageState> => {
    const outcome = await flush({ endpoint, post });
    return { ...state, draft: currentDraft(), notice: noticeAfterFlush(outcome, state.notice) };
  };

  const flushAndDraw = async (): Promise<void> => draw(await settled());

  const submit = async (score: Score): Promise<void> => {
    const validated = validateScore({ scoring: event.scoring, capSeconds: event.capSeconds, score });
    const draft = readDraft(root, state.draft ?? emptyDraft(event));
    if (!validated.success) {
      draw({ ...state, draft, notice: { kind: "error", text: validated.error } });
      return;
    }
    const selected = resolveJudgeHeat({ schedule, event, lane, now: now(), manual: state.manual });
    if (!selected.lane) return;

    enqueue(
      buildSubmission({
        judge: loadJudgeName() ?? "",
        event,
        heat: selected.heat,
        lane: selected.lane,
        score: validated.data,
        now: now(),
        clientId: newClientId(),
      }),
    );
    markHeatSent({ event: event.number, lane, heat: selected.heat.number });
    draw({
      manual: state.manual,
      draft: undefined,
      notice: { kind: "recorded", text: `Recorded ✓ — ${selected.lane.team}: ${formatScore(validated.data)}` },
    });
    await flushAndDraw();
  };

  const tick = async (): Promise<void> => {
    if (!isTypingIn(root)) draw({ ...state, draft: currentDraft() });
    if (loadQueue().length === 0) return;
    const next = await settled();
    if (isTypingIn(root)) commit(next);
    else draw(next);
  };

  draw(INITIAL);
  return { tick };
};
