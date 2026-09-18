import { sourceNotice, type LoadedSchedule } from "../core/load-schedule";
import { buildClaim, buildRelease, emptyDraft, validateClaim, type ClaimDraft, type SlotKey } from "../core/signup";
import type { Schedule } from "../core/types";
import { renderSignup, type SignupNotice } from "./render-signup";
import { saveCachedSchedule } from "./schedule-store";
import { postClaim, postRelease, type WriteOutcome } from "./signup-client";
import { loadLastClaim, loadSignupEmail, saveLastClaim, saveSignupEmail } from "./signup-store";

export type SignupPageOptions = {
  readonly root: HTMLElement;
  readonly initial: LoadedSchedule;
  readonly loadSchedule: () => Promise<LoadedSchedule>;
  readonly endpoint: string;
  readonly fetchFn: typeof fetch;
};

export type SignupPage = { readonly refresh: () => Promise<void>; readonly schedule: () => Schedule };

type PageState = {
  readonly loaded: LoadedSchedule;
  readonly openForm: SlotKey | undefined;
  readonly draft: ClaimDraft | undefined;
  readonly notice: SignupNotice | undefined;
  readonly busy: boolean;
};

const UNREACHABLE_TEXT = "Couldn't reach the sheet — try again";

const draftFor = (current: ClaimDraft | undefined): ClaimDraft => current ?? loadLastClaim() ?? emptyDraft();

const live = (schedule: Schedule): LoadedSchedule => {
  saveCachedSchedule(schedule);
  return { schedule, source: "live" };
};

export const startSignupPage = ({ root, initial, loadSchedule, endpoint, fetchFn }: SignupPageOptions): SignupPage => {
  let state: PageState = { loaded: initial, openForm: undefined, draft: undefined, notice: undefined, busy: false };

  const draw = (next: PageState): void => {
    state = next;
    const { loaded } = state;
    renderSignup({
      root,
      schedule: loaded.schedule,
      email: loadSignupEmail(),
      sourceNotice: sourceNotice(loaded),
      live: loaded.source === "live",
      openForm: state.openForm,
      draft: draftFor(state.draft),
      notice: state.notice,
      busy: state.busy,
      onEmailSubmit: (email) => {
        saveSignupEmail(email);
        draw({ ...state, notice: undefined });
      },
      onEmailClear: () => {
        saveSignupEmail(undefined);
        draw({ ...state, openForm: undefined, notice: undefined });
      },
      onOpenForm: (slot) => draw({ ...state, openForm: slot, notice: undefined }),
      onCloseForm: () => draw({ ...state, openForm: undefined, notice: undefined }),
      onClaim: (draft) => void claim(draft),
      onRelease: (slot) => void release(slot),
      onDraftChange: (draft) => draw({ ...state, draft }),
    });
  };

  type SettleOptions = { readonly outcome: WriteOutcome; readonly at: SlotKey; readonly draft: ClaimDraft | undefined };

  const settle = async ({ outcome, at, draft }: SettleOptions): Promise<void> => {
    if (outcome.kind === "accepted") {
      const loaded = outcome.schedule ? live(outcome.schedule) : await loadSchedule();
      draw({ loaded, openForm: undefined, draft, notice: undefined, busy: false });
      return;
    }
    if (outcome.kind === "rejected") {
      const loaded = outcome.schedule ? live(outcome.schedule) : state.loaded;
      draw({ loaded, openForm: undefined, draft, notice: { kind: "error", text: outcome.error, at }, busy: false });
      return;
    }
    draw({ ...state, draft, notice: { kind: "error", text: UNREACHABLE_TEXT, at }, busy: false });
  };

  const claim = async (draft: ClaimDraft): Promise<void> => {
    const email = loadSignupEmail();
    const slot = state.openForm;
    if (!email || !slot) return;
    const validated = validateClaim({ draft, divisions: state.loaded.schedule.divisions });
    if (!validated.success) {
      draw({ ...state, draft, notice: { kind: "error", text: validated.error, at: slot } });
      return;
    }
    draw({ ...state, draft, busy: true, notice: undefined });
    const outcome = await postClaim({ endpoint, claim: buildClaim({ slot, email, fields: validated.data }), fetchFn });
    if (outcome.kind === "accepted") saveLastClaim(draft);
    await settle({ outcome, at: slot, draft });
  };

  const release = async (slot: SlotKey): Promise<void> => {
    const email = loadSignupEmail();
    if (!email) return;
    draw({ ...state, busy: true, notice: undefined });
    const outcome = await postRelease({ endpoint, release: buildRelease({ slot, email }), fetchFn });
    await settle({ outcome, at: slot, draft: state.draft });
  };

  const refresh = async (): Promise<void> => {
    if (state.openForm || state.busy) return;
    const before = state.loaded;
    const loaded = await loadSchedule();
    if (state.openForm || state.busy || state.loaded !== before) return;
    draw({ ...state, loaded });
  };

  draw(state);
  return { refresh, schedule: () => state.loaded.schedule };
};
