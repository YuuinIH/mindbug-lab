import { type FlowHooks, type z } from "@yuuinih/turn-kernel";
import { attackParticipants } from "./damage.js";
import { strikeInput, type strikeSettlement } from "./strike-definition.js";
import { mark, type Battle } from "./model.js";
import { attach } from "./operations.js";

type DamageResult =
  | z.infer<typeof strikeInput>
  | ReturnType<typeof strikeSettlement.parse>;

/** Game-owned hook objects. The flow executor owns invocation and ordering. */
export const damageHooks: FlowHooks<
  Battle,
  z.infer<typeof strikeInput>,
  DamageResult
> = {
  before: {
    handlers: [
      {
        id: "check-attack-participants",
        version: "1",
        order: 0,
        run(state, input) {
          attackParticipants(state, input.source, input.target);
          return { kind: "continue" };
        },
      },
    ],
  },
  after: {
    handlers: [
      {
        id: "after-damage-strengthen",
        version: "2",
        order: 0,
        operations: [attach.operation],
        flows: [],
        run(state, event) {
          const id = `reaction:${event.frameId}`;
          if (
            state.world.entities.some((e) => e.ref.id === id) ||
            state.world.retiredIds.includes(id)
          )
            return [];
          return [
            {
              kind: "operation",
              request: attach.request({
                id: mark.ref(state.world.sessionId, id),
                target: event.input.source,
                source: event.input.source,
                bonus: 2,
                discount: 0,
              }),
            },
          ];
        },
      },
    ],
  },
};
