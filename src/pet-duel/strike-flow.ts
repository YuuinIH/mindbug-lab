import {
  z,
  nextRandom,
  type FlowDefinition,
  type Frame,
} from "@yuuinih/turn-kernel";
import { attackParticipants } from "./damage.js";
import { effectiveAttack } from "./values.js";
import { type Battle } from "./model.js";
import {
  strikeSettlement,
  strikeInput,
  parsePendingStrike,
} from "./strike-definition.js";
import { consumeStrikeRandom, applyStrike } from "./strike-operations.js";
export function pendingStrikeFrame(frame: Frame, sessionId: string) {
  const s = parsePendingStrike(frame.data);
  if (s.id !== frame.id || s.sessionId !== sessionId)
    throw Error("Strike settlement belongs to another frame");
  return s;
}
export const strikeFlow: FlowDefinition<Battle> = {
  id: "strike",
  version: "1",
  steps: {
    sample: {
      parseData: (input) => strikeInput.parse(input),
      advance(state, frame) {
        const input = strikeInput.parse(frame.data);
        const { defender } = attackParticipants(
          state,
          input.source,
          input.target,
        );
        const attack = effectiveAttack(state, input.source),
          random = nextRandom(state.rng, 3);
        let settlement = strikeSettlement.start(
          { sessionId: state.world.sessionId, id: frame.id },
          { ...input, attack, rolled: random.value, team: defender.team },
        );
        settlement = strikeSettlement.seed(
          settlement,
          "sampledDamage",
          attack + random.value,
        );
        settlement = strikeSettlement.advance(settlement);
        settlement = strikeSettlement.seed(
          settlement,
          "incomingDamage",
          strikeSettlement.read(settlement, "sampledDamage"),
        );
        return {
          kind: "next",
          step: "respond",
          data: settlement,
          operations: [consumeStrikeRandom.request({ expected: state.rng })],
        };
      },
    },
    respond: {
      parseData: parsePendingStrike,
      parseChoice(input, state, frame) {
        const s = pendingStrikeFrame(frame, state.world.sessionId);
        const { defender } = attackParticipants(
          state,
          s.input.source,
          s.input.target,
        );
        if (defender.team !== s.input.team)
          throw Error("Strike defender changed");
        return z.boolean().parse(input);
      },
      advance(state, frame, choice) {
        let s = pendingStrikeFrame(frame, state.world.sessionId);
        if (choice === undefined)
          return { kind: "wait", actor: s.input.team, operations: [] };
        if (z.boolean().parse(choice)) {
          s = strikeSettlement.modify(s, {
            id: "guard",
            target: strikeSettlement.ref(s, "incomingDamage"),
            source: s.input.target,
            mode: "multiply",
            amount: 0.5,
          });
        }
        s = strikeSettlement.advance(s);
        return {
          kind: "done",
          result: strikeSettlement.complete(s),
          operations: [applyStrike.request(s)],
        };
      },
    },
  },
};
