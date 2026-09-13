import { strikeFlow } from "./strike-flow.js";
import { z } from "@yuuinih/turn-kernel";
import {
  FlowRuntime,
  WorldQuery,
  type FlowDefinition,
} from "@yuuinih/turn-kernel";
import { pet, type Battle } from "./model.js";
import { begin, damage, end, operationRuntime } from "./operations.js";
const dataSchema = z.strictObject({
  source: z.unknown().transform(pet.parseRef),
  target: z.unknown().transform(pet.parseRef),
  scope: z.string().min(1),
});
const switchSchema = z.strictObject({ team: z.enum(["A", "B"]) });
export const chooseReplacement: FlowDefinition<Battle> = {
  id: "choose-replacement",
  version: "1",
  steps: {
    choose: {
      parseData: (v) => switchSchema.parse(v),
      parseChoice: (input, state, frame) => {
        const ref = pet.parseRef(input);
        const target = new WorldQuery(state.world).get(pet, ref);
        const data = switchSchema.parse(frame.data);
        if (target.health.hp === 0 || target.team !== data.team)
          throw Error("Ineligible replacement");
        return ref;
      },
      advance: (_state, frame, choice) =>
        choice === undefined
          ? {
              kind: "wait",
              actor: switchSchema.parse(frame.data).team,
              operations: [],
            }
          : { kind: "done", result: pet.parseRef(choice), operations: [] },
    },
  },
};
export const combo: FlowDefinition<Battle> = {
  id: "combo",
  version: "1",
  steps: {
    start: {
      parseData: (v) => dataSchema.parse(v),
      advance: (_state, frame) => {
        const data = dataSchema.parse(frame.data);
        return {
          kind: "next",
          step: "first",
          data,
          operations: [
            begin.request({ source: data.source, flowId: data.scope }),
          ],
        };
      },
    },
    first: {
      parseData: (v) => dataSchema.parse(v),
      advance: (_state, frame) => {
        const data = dataSchema.parse(frame.data);
        return {
          kind: "next",
          step: "after-first",
          data,
          operations: [
            damage.request({ source: data.source, target: data.target }),
          ],
        };
      },
    },
    "after-first": {
      parseData: (v) => dataSchema.parse(v),
      advance: (state, frame) => {
        const data = dataSchema.parse(frame.data);
        const query = new WorldQuery(state.world);
        const target = query.get(pet, data.target);
        if (target.health.hp > 0)
          return { kind: "next", step: "second", data, operations: [] };
        if (
          !query.refs(pet).some((ref) => {
            const p = query.get(pet, ref);
            return p.team === target.team && p.health.hp > 0;
          })
        ) {
          return {
            kind: "done",
            result: { winner: query.get(pet, data.source).team },
            operations: [end.request(data.scope)],
          };
        }
        return {
          kind: "call",
          child: {
            type: "choose-replacement",
            version: "1",
            step: "choose",
            data: { team: target.team },
          },
          resumeStep: "second",
          data,
          operations: [],
        };
      },
    },
    second: {
      parseData: (v) => dataSchema.parse(v),
      advance: (_state, frame) => {
        const data = dataSchema.parse(frame.data);
        const target =
          frame.childResult === null
            ? data.target
            : pet.parseRef(frame.childResult);
        return {
          kind: "done",
          result: { target },
          operations: [
            damage.request({ source: data.source, target }),
            end.request(data.scope),
          ],
        };
      },
    },
  },
};
export function flowRuntime() {
  return new FlowRuntime(
    [combo, chooseReplacement, strikeFlow],
    operationRuntime(),
  );
}
