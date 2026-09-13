import { isDeepStrictEqual } from "node:util";
import {
  z,
  defineOperation,
  nextRandom,
  authorizeComponentWrite,
} from "@yuuinih/turn-kernel";
import { petHealth, type Battle } from "./model.js";
import { applyDamage } from "./damage.js";
import { strikeSettlement } from "./strike-definition.js";
import type { Fact } from "./operations.js";
const randomInput = z.strictObject({
  expected: z.number().int().min(0).max(0xffffffff),
});
export const consumeStrikeRandom = defineOperation<
  Battle,
  z.infer<typeof randomInput>,
  Fact
>({
  id: "consume-strike-random",
  version: "1",
  parse: (input) => randomInput.parse(input),
  execute(state, input) {
    if (state.rng !== input.expected) throw Error("Stale random sample");
    state.rng = nextRandom(state.rng, 3).state;
    return { state, facts: [] };
  },
  authorize(before, after) {
    if (
      after.rng !== nextRandom(before.rng, 3).state ||
      !isDeepStrictEqual(before, { ...after, rng: before.rng })
    )
      throw Error("Random write scope denied");
  },
});
export const applyStrike = defineOperation<
  Battle,
  ReturnType<typeof strikeSettlement.parse>,
  Fact
>({
  id: "apply-strike",
  version: "1",
  parse: strikeSettlement.parse,
  execute(state, settlement) {
    if (
      settlement.sessionId !== state.world.sessionId ||
      settlement.status !== "ready"
    )
      throw Error("Strike is not ready");
    return applyDamage(
      state,
      settlement.input.source,
      settlement.input.target,
      strikeSettlement.read(settlement, "incomingDamage"),
      settlement.input.rolled,
    );
  },
  authorize(before, after, settlement) {
    authorizeComponentWrite(
      before.world,
      after.world,
      petHealth,
      settlement.input.target,
    );
    if (!isDeepStrictEqual(before, { ...after, world: before.world }))
      throw Error("Strike changed unrelated state");
  },
});
export const strikeOperations = [
  consumeStrikeRandom.operation,
  applyStrike.operation,
];
