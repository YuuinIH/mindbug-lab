import { z } from "@yuuinih/turn-kernel";
import {
  defineOperation,
  OperationRuntime,
  WorldEditor,
  WorldQuery,
  nextRandom,
  type Ref,
} from "@yuuinih/turn-kernel";
import {
  assertSameIdentities,
  attached,
  mark,
  parseBattle,
  pet,
  prune,
  relations,
  source,
  type Battle,
} from "./model.js";
import { effectiveAttack, effectiveCost } from "./values.js";
const petRef = z.unknown().transform((v) => pet.parseRef(v));
const markRef = z.unknown().transform((v) => mark.parseRef(v));
export type Fact =
  | { kind: "healed"; target: Ref<"pet">; amount: number }
  | {
      kind: "damaged";
      source: Ref<"pet">;
      target: Ref<"pet">;
      hpLost: number;
      absorbed: number;
      rolled: number;
    }
  | { kind: "mark-added" | "mark-removed"; id: string }
  | { kind: "paid"; amount: number }
  | { kind: "scope-ended"; id: string };
const edit = (state: Battle, kinds: readonly string[]) =>
  new WorldEditor(
    state.world,
    { objects: kinds, relations: relations.map((r) => r.id) },
    relations,
  );
const read = (state: Battle) => new WorldQuery(state.world);
function authorize(kinds: readonly string[]) {
  return (a: Battle, b: Battle): void => {
    assertSameIdentities(a, b);
    for (const e of a.world.entities) {
      if (kinds.includes(e.ref.kind)) continue;
      const next = b.world.entities.find((x) => x.ref.id === e.ref.id);
      if (JSON.stringify(e) !== JSON.stringify(next))
        throw Error("Object write scope denied");
    }
    for (const e of b.world.entities)
      if (
        !kinds.includes(e.ref.kind) &&
        !a.world.entities.some((x) => x.ref.id === e.ref.id)
      )
        throw Error("Creation denied");
  };
}
const healInput = z.strictObject({
  target: petRef,
  amount: z.number().int().positive(),
});
export const heal = defineOperation<Battle, z.infer<typeof healInput>, Fact>({
  id: "heal",
  version: "1",
  parse: (v) => healInput.parse(v),
  execute(state, input) {
    const target = read(state).get(pet, input.target);
    if (target.hp === 0) throw Error("Cannot heal defeated pet");
    const hp = Math.min(target.maxHp, target.hp + input.amount);
    edit(state, ["pet"]).set(pet, input.target, { ...target, hp });
    return {
      state,
      facts: [{ kind: "healed", target: input.target, amount: hp - target.hp }],
    };
  },
  authorize: authorize(["pet"]),
});
const attachInput = z.strictObject({
  id: markRef,
  target: petRef,
  source: petRef,
  bonus: z.number().int(),
  discount: z.number().int().min(0),
});
export const attach = defineOperation<
  Battle,
  z.infer<typeof attachInput>,
  Fact
>({
  id: "attach",
  version: "1",
  parse: (v) => attachInput.parse(v),
  execute(state, input) {
    read(state).get(pet, input.target);
    read(state).get(pet, input.source);
    const editor = edit(state, ["mark"]);
    editor.create(mark, input.id, {
      stacks: 1,
      bonus: input.bonus,
      discount: input.discount,
    });
    editor.link({
      id: `${input.id.id}:attached`,
      type: attached.id,
      from: input.id,
      to: input.target,
    });
    editor.link({
      id: `${input.id.id}:source`,
      type: source.id,
      from: input.id,
      to: input.source,
    });
    state.modifiers.push(
      {
        id: `${input.id.id}:attack`,
        target: input.target,
        valueId: "attack",
        mode: "add",
        amount: input.bonus,
        source: input.id,
        lifetime: { kind: "source" },
      },
      {
        id: `${input.id.id}:cost`,
        target: input.target,
        valueId: "cost",
        mode: "add",
        amount: input.discount === 0 ? 0 : -input.discount,
        source: input.id,
        lifetime: { kind: "source" },
      },
    );
    return { state, facts: [{ kind: "mark-added", id: input.id.id }] };
  },
  authorize: authorize(["mark"]),
});
export const remove = defineOperation<Battle, Ref<"mark">, Fact>({
  id: "remove-mark",
  version: "1",
  parse: mark.parseRef,
  execute(state, input) {
    edit(state, ["mark"]).remove(input);
    prune(state);
    return { state, facts: [{ kind: "mark-removed", id: input.id }] };
  },
  authorize: authorize(["mark"]),
});
const beginInput = z.strictObject({
  source: petRef,
  flowId: z.string().min(1),
});
export const begin = defineOperation<Battle, z.infer<typeof beginInput>, Fact>({
  id: "begin-combo",
  version: "1",
  parse: (v) => beginInput.parse(v),
  execute(state, input) {
    const attacker = read(state).get(pet, input.source);
    const cost = effectiveCost(state, input.source);
    if (
      attacker.hp === 0 ||
      attacker.energy < cost ||
      state.activeFlows.includes(input.flowId)
    )
      throw Error("Cannot start combo");
    edit(state, ["pet"]).set(pet, input.source, {
      ...attacker,
      energy: attacker.energy - cost,
    });
    state.activeFlows.push(input.flowId);
    state.modifiers.push({
      id: `${input.flowId}:attack`,
      target: input.source,
      valueId: "attack",
      mode: "multiply",
      amount: 1.2,
      source: input.source,
      lifetime: { kind: "flow", flowId: input.flowId },
    });
    return { state, facts: [{ kind: "paid", amount: cost }] };
  },
  authorize: authorize(["pet"]),
});
const damageInput = z.strictObject({ source: petRef, target: petRef });
export const damage = defineOperation<
  Battle,
  z.infer<typeof damageInput>,
  Fact
>({
  id: "damage",
  version: "1",
  parse: (v) => damageInput.parse(v),
  execute(state, input) {
    const attacker = read(state).get(pet, input.source);
    const target = read(state).get(pet, input.target);
    if (attacker.hp === 0 || target.hp === 0 || attacker.team === target.team)
      throw Error("Invalid attack participants");
    const random = nextRandom(state.rng, 3);
    state.rng = random.state;
    const amount = effectiveAttack(state, input.source) + random.value;
    const absorbed = Math.min(target.shield, amount);
    const hpLost = Math.min(target.hp, amount - absorbed);
    edit(state, ["pet"]).set(pet, input.target, {
      ...target,
      shield: target.shield - absorbed,
      hp: target.hp - hpLost,
    });
    return {
      state,
      facts: [
        {
          kind: "damaged",
          source: input.source,
          target: input.target,
          absorbed,
          hpLost,
          rolled: random.value,
        },
      ],
    };
  },
  authorize: authorize(["pet"]),
});
export const end = defineOperation<Battle, string, Fact>({
  id: "end-combo",
  version: "1",
  parse: (v) => z.string().min(1).parse(v),
  execute(state, id) {
    if (!state.activeFlows.includes(id)) throw Error("Missing flow scope");
    state.activeFlows = state.activeFlows.filter((f) => f !== id);
    prune(state);
    return { state, facts: [{ kind: "scope-ended", id }] };
  },
  authorize: authorize([]),
});
export const operationDefinitions = [
  heal.operation,
  attach.operation,
  remove.operation,
  begin.operation,
  damage.operation,
  end.operation,
];
export function operationRuntime() {
  return new OperationRuntime(
    parseBattle,
    operationDefinitions,
    [],
    [
      {
        id: "after-damage-strengthen",
        order: 0,
        react: (state, fact) => {
          if (fact.kind !== "damaged") return [];
          const id = `reaction:${state.rng}`;
          if (
            state.world.entities.some((e) => e.ref.id === id) ||
            state.world.retiredIds.includes(id)
          )
            return [];
          return [
            attach.request({
              id: mark.ref(state.world.sessionId, id),
              target: fact.source,
              source: fact.source,
              bonus: 2,
              discount: 0,
            }),
          ];
        },
      },
    ],
  );
}

const factSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("healed"),
    target: petRef,
    amount: z.number().int().min(0),
  }),
  z.strictObject({
    kind: z.literal("damaged"),
    source: petRef,
    target: petRef,
    hpLost: z.number().int().min(0),
    absorbed: z.number().int().min(0),
    rolled: z.number().int().min(0).max(2),
  }),
  z.strictObject({
    kind: z.enum(["mark-added", "mark-removed"]),
    id: z.string().min(1),
  }),
  z.strictObject({ kind: z.literal("paid"), amount: z.number().int().min(0) }),
  z.strictObject({ kind: z.literal("scope-ended"), id: z.string().min(1) }),
]);
export function parseFact(input: unknown): Fact {
  return factSchema.parse(input);
}
