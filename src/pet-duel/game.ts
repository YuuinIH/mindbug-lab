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
  z.strictObject({
    kind: z.literal("heal"),
    target: petRef,
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
    .add(registration("object", "pet", "1", pet))
    .add(registration("object", "mark", "1", mark));
  for (const relation of relations)
    builder.add(
      registration("relation", relation.id, relation.version, relation, [
        `object:${relation.from}`,
        `object:${relation.to}`,
      ]),
    );
  for (const value of valueDefinitions)
    builder.add(
      registration("value", value.id, value.version, value, ["object:pet"]),
    );
  for (const operation of operationDefinitions)
    builder.add(
      registration("operation", operation.id, operation.version, operation),
    );
  builder.add(
    registration("flow", combo.id, combo.version, combo, [
      "operation:damage",
      "operation:begin-combo",
      "operation:end-combo",
      "flow:choose-replacement",
    ]),
  );
  builder.add(
    registration(
      "flow",
      chooseReplacement.id,
      chooseReplacement.version,
      chooseReplacement,
      ["object:pet"],
    ),
  );
  const ruleset = builder.build("pet-duel", "3");
  const flows = flowRuntime();
  const operations = operationRuntime();
  function parseState(input: unknown): PetSession {
    const v = envelope.parse(input);
    const battle = parseBattle(v.battle);
    const flow = v.flow === null ? null : flows.parse(v.flow);
    if (battle.world.sessionId !== sessionId) throw Error("Foreign session");
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
      if (command.kind === "choose") {
        if (!state.flow || state.flow.status !== "waiting")
          return { ok: false, reason: "No pending choice" };
        const result = flows.run(
          { state: state.battle, flow: state.flow },
          {
            promptId: command.promptId,
            actor: command.actor,
            value: command.target,
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
      if (state.flow && state.flow.status !== "finished")
        return {
          ok: false,
          reason: "Flow must complete before another command",
        };
      if (command.kind === "combo") {
        const scope = `combo:${state.nextScope}`;
        const flow = flows.start(
          {
            type: "combo",
            version: "1",
            step: "start",
            data: { source: command.source, target: command.target, scope },
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
