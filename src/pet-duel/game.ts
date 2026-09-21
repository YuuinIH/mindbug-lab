import { rulesetBuildId } from "../../ruleset-build.js";
import { hitFlow } from "./hit-flow.js";
import { strikeFlow, pendingStrikeFrame } from "./strike-flow.js";
import { strikeSettlement } from "./strike-definition.js";
import { z } from "@yuuinih/turn-kernel";
import {
  createSession,
  restoreSession,
  registration,
  RulesetBuilder,
  type FlowState,
  type GameDefinition,
} from "@yuuinih/turn-kernel";
import { combo, chooseReplacement, flowRuntime } from "./flows.js";
import {
  initialBattle,
  healable,
  componentDefinitions,
  objectDefinitions,
  mark,
  parseBattle,
  pet,
  relations,
  type Battle,
} from "./model.js";
import {
  attach,
  heal,
  operationDefinitions,
  operationRuntime,
  remove,
  type Fact,
} from "./operations.js";
import { valueDefinitions } from "./values.js";
const petRef = z.unknown().transform(pet.parseRef);
const markRef = z.unknown().transform(mark.parseRef);
const commandSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("strike"), source: petRef, target: petRef }),
  z.strictObject({
    kind: z.literal("respond"),
    promptId: z.string().min(1),
    actor: z.string().min(1),
    guard: z.boolean(),
  }),
  z.strictObject({
    kind: z.literal("heal"),
    target: z.unknown().transform(healable.parseRef),
    amount: z.number().int().positive(),
  }),
  z.strictObject({
    kind: z.literal("attach"),
    id: markRef,
    target: petRef,
    source: petRef,
    bonus: z.number().int(),
    discount: z.number().int().min(0),
  }),
  z.strictObject({ kind: z.literal("remove"), target: markRef }),
  z.strictObject({ kind: z.literal("combo"), source: petRef, target: petRef }),
  z.strictObject({
    kind: z.literal("choose"),
    promptId: z.string().min(1),
    actor: z.string().min(1),
    target: petRef,
  }),
]);
export type PetCommand = z.infer<typeof commandSchema>;
export interface PetSession {
  battle: Battle;
  flow: FlowState | null;
  nextScope: number;
}
const envelope = z.strictObject({
  battle: z.unknown(),
  flow: z.unknown(),
  nextScope: z.number().int().min(0),
});
export function petGame(
  sessionId: string,
): GameDefinition<PetSession, PetCommand, Fact> {
  const builder = new RulesetBuilder()
    .add(registration("settlement", strikeSettlement.id, strikeSettlement))
    .add(
      registration("flow", strikeFlow.id, strikeFlow, [
        "settlement:strike-damage",
        "operation:consume-strike-random",
        "operation:apply-strike",
        "operation:attach",
      ]),
    );
  for (const component of componentDefinitions)
    builder.add(registration("component", component.id, component));
  for (const object of objectDefinitions)
    builder.add(
      registration(
        "object",
        object.kind,
        object,
        object.components.map((c) => `component:${c.id}`),
      ),
    );
  for (const relation of relations)
    builder.add(
      registration("relation", relation.id, relation, [
        typeof relation.from === "string"
          ? `object:${relation.from}`
          : `component:${relation.from.component}`,
        typeof relation.to === "string"
          ? `object:${relation.to}`
          : `component:${relation.to.component}`,
      ]),
    );
  for (const value of valueDefinitions)
    builder.add(
      registration("value", value.id, value, [
        `component:${value.component.id}`,
      ]),
    );
  for (const operation of operationDefinitions)
    builder.add(registration("operation", operation.id, operation));
  builder.add(
    registration("flow", hitFlow.id, hitFlow, [
      "operation:damage",
      "operation:attach",
    ]),
  );
  builder.add(
    registration("flow", combo.id, combo, [
      "flow:hit",
      "operation:begin-combo",
      "operation:end-combo",
      "flow:choose-replacement",
    ]),
  );
  builder.add(
    registration("flow", chooseReplacement.id, chooseReplacement, [
      "object:pet",
    ]),
  );
  const ruleset = builder.build("pet-duel", rulesetBuildId);
  const flows = flowRuntime();
  const operations = operationRuntime();
  function parseState(input: unknown): PetSession {
    const v = envelope.parse(input);
    const battle = parseBattle(v.battle);
    const flow = v.flow === null ? null : flows.parse(v.flow);
    if (battle.world.sessionId !== sessionId) throw Error("Foreign session");
    for (const frame of flow?.stack ?? [])
      if (frame.type === "strike" && frame.step === "respond")
        pendingStrikeFrame(frame, sessionId);
    const scopes =
      flow?.stack
        .filter((f) => f.type === "combo")
        .map((f) => {
          if (
            typeof f.data !== "object" ||
            f.data === null ||
            !("scope" in f.data) ||
            typeof f.data.scope !== "string"
          )
            throw Error("Missing scope");
          return f.data.scope;
        }) ?? [];
    if (battle.activeFlows.some((id) => !scopes.includes(id)))
      throw Error("Orphan flow modifier scope");
    return { battle, flow, nextScope: v.nextScope };
  }
  return {
    ruleset: ruleset.id,
    parseState,
    parseCommand: (v) => commandSchema.parse(v),
    decide(state, command) {
      if (command.kind === "choose" || command.kind === "respond") {
        if (!state.flow || state.flow.status !== "waiting")
          return { ok: false, reason: "No pending choice" };
        const result = flows.run(
          { state: state.battle, flow: state.flow },
          {
            promptId: command.promptId,
            actor: command.actor,
            value: command.kind === "choose" ? command.target : command.guard,
          },
        );
        if (result.flow.status === "fault")
          return {
            ok: false,
            reason: result.flow.error ?? "Flow execution failed",
          };
        return {
          ok: true,
          state: { ...state, battle: result.state, flow: result.flow },
          facts: result.facts,
        };
      }
      if (
        state.flow &&
        state.flow.status !== "finished" &&
        state.flow.status !== "cancelled"
      )
        return {
          ok: false,
          reason: "Flow must complete before another command",
        };
      if (command.kind === "combo" || command.kind === "strike") {
        const scope = `${command.kind}:${state.nextScope}`;
        const flow = flows.start(
          {
            type: command.kind,
            step: command.kind === "combo" ? "start" : "sample",
            data:
              command.kind === "combo"
                ? { source: command.source, target: command.target, scope }
                : { source: command.source, target: command.target },
          },
          `${sessionId}:${scope}`,
        );
        const result = flows.run({ state: state.battle, flow });
        if (result.flow.status === "fault")
          return {
            ok: false,
            reason: result.flow.error ?? "Flow execution failed",
          };
        return {
          ok: true,
          state: {
            battle: result.state,
            flow: result.flow,
            nextScope: state.nextScope + 1,
          },
          facts: result.facts,
        };
      }
      const request =
        command.kind === "heal"
          ? heal.request({ target: command.target, amount: command.amount })
          : command.kind === "remove"
            ? remove.request(command.target)
            : attach.request({
                id: command.id,
                target: command.target,
                source: command.source,
                bonus: command.bonus,
                discount: command.discount,
              });
      const result = operations.execute(state.battle, [request]);
      return {
        ok: true,
        state: { ...state, battle: result.state },
        facts: result.facts,
      };
    },
  };
}
export function createPetDuel(id: string) {
  return createSession(petGame(id), id, {
    battle: initialBattle(id),
    flow: null,
    nextScope: 0,
  });
}
export function restorePetDuel(id: string, input: unknown) {
  const session = restoreSession(petGame(id), input);
  if (session.snapshot().sessionId !== id) throw Error("Foreign envelope");
  return session;
}
