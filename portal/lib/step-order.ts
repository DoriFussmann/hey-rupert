// The order of the work panels on the admin client page: the next step on
// top, finished ones together in a collapsed group under it. Pure module.

/** Whose move a step is: Rupert's, the client's, or nobody's yet (not reachable). */
export type StepTurn = "admin" | "client" | "none";

export type StepState = { key: string; done: boolean; turn: StepTurn };

/**
 * The next step is the first one, in process order, that is Rupert's move.
 * When nothing is his, the first that waits on the client. Everything else
 * not finished is "open"; finished steps are "completed", in process order.
 */
export function arrangeSteps<T extends StepState>(steps: T[]) {
  const pending = steps.filter((step) => !step.done);
  const current = pending.find((step) => step.turn === "admin") ?? pending.find((step) => step.turn === "client") ?? null;
  return {
    current,
    open: pending.filter((step) => step !== current),
    completed: steps.filter((step) => step.done),
  };
}
