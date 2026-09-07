import { z } from "zod";
import {
  FlowRuntime,
  WorldQuery,
  type FlowDefinition,
} from "@yuuinih/turn-kernel";
import { pet, type Battle } from "./model.js";
import { begin, damage, end, operationRuntime } from "./operations.js";
const localsSchema = z.strictObject({
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
      parseLocals: (v) => switchSchema.parse(v),
      parseChoice: (input, state, frame) => {
        const ref = pet.parseRef(input);
        const target = new WorldQuery(state.world).get(pet, ref);
        const locals = switchSchema.parse(frame.locals);
        if (target.hp === 0 || target.team !== locals.team)
          throw Error("Ineligible replacement");
        return ref;
      },
      advance: (_state, frame, choice) =>
        choice === undefined
          ? {
              kind: "wait",
              actor: switchSchema.parse(frame.locals).team,
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
      parseLocals: (v) => localsSchema.parse(v),
      advance: (_state, frame) => {
        const locals = localsSchema.parse(frame.locals);
        return {
          kind: "next",
          step: "first",
          locals,
          operations: [
            begin.request({ source: locals.source, flowId: locals.scope }),
          ],
        };
      },
    },
    first: {
      parseLocals: (v) => localsSchema.parse(v),
      advance: (_state, frame) => {
        const locals = localsSchema.parse(frame.locals);
        return {
          kind: "next",
          step: "after-first",
          locals,
          operations: [
            damage.request({ source: locals.source, target: locals.target }),
          ],
        };
      },
    },
    "after-first": {
      parseLocals: (v) => localsSchema.parse(v),
      advance: (state, frame) => {
        const locals = localsSchema.parse(frame.locals);
        const query = new WorldQuery(state.world);
        const target = query.get(pet, locals.target);
        if (target.hp > 0)
          return { kind: "next", step: "second", locals, operations: [] };
        if (
          !query.refs(pet).some((ref) => {
            const p = query.get(pet, ref);
            return p.team === target.team && p.hp > 0;
          })
        ) {
          return {
            kind: "done",
            result: { winner: query.get(pet, locals.source).team },
            operations: [end.request(locals.scope)],
          };
        }
        return {
          kind: "call",
          child: {
            type: "choose-replacement",
            version: "1",
            step: "choose",
            locals: { team: target.team },
          },
          resumeStep: "second",
          locals,
          operations: [],
        };
      },
    },
    second: {
      parseLocals: (v) => localsSchema.parse(v),
      advance: (_state, frame) => {
        const locals = localsSchema.parse(frame.locals);
        const target =
          frame.childResult === null
            ? locals.target
            : pet.parseRef(frame.childResult);
        return {
          kind: "done",
          result: { target },
          operations: [
            damage.request({ source: locals.source, target }),
            end.request(locals.scope),
          ],
        };
      },
    },
  },
};
export function flowRuntime() {
  return new FlowRuntime([combo, chooseReplacement], operationRuntime());
}
