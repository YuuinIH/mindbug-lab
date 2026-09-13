import { applyDamage, attackParticipants } from "./damage.js";
import { strikeOperations } from "./strike-operations.js";
import { isDeepStrictEqual } from "node:util";
import { z } from "@yuuinih/turn-kernel";
import {
  defineOperation,
  authorizeComponentWrite,
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
  healable,
  petCombat,
  prune,
  relations,
  source,
  type Battle,
} from "./model.js";
import {
  attack,
  cost as costValue,
  effectiveAttack,
  effectiveCost,
} from "./values.js";
const petRef = z.unknown().transform((v) => pet.parseRef(v));
const healableRef = z.unknown().transform(healable.parseRef);
const markRef = z.unknown().transform((v) => mark.parseRef(v));
export type Fact =
  | { kind: "healed"; target: Ref<"pet" | "tower">; amount: number }
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
  target: healableRef,
  amount: z.number().int().positive(),
});
export const heal = defineOperation<Battle, z.infer<typeof healInput>, Fact>({
  id: "heal",
  version: "1",
  parse: (v) => healInput.parse(v),
  execute(state, input) {
    const target = read(state).component(healable, input.target);
    if (target.hp === 0) throw Error("Cannot heal defeated pet");
    const hp = Math.min(target.maxHp, target.hp + input.amount);
    new WorldEditor(
      state.world,
      {
        objects: [],
        relations: [],
        components: healable.kinds.map((kind) => ({
          kind,
          component: healable.component.id,
        })),
      },
      relations,
    ).setComponent(healable, input.target, { ...target, hp });
    return {
      state,
      facts: [{ kind: "healed", target: input.target, amount: hp - target.hp }],
    };
  },
  authorize(before, after, input) {
    authorizeComponentWrite(before.world, after.world, healable, input.target);
    if (!isDeepStrictEqual(before, { ...after, world: before.world }))
      throw Error("Healing changed unrelated battle state");
  },
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
      attack.modifier({
        id: `${input.id.id}:attack`,
        target: input.target,
        mode: "add",
        amount: input.bonus,
        source: input.id,
        lifetime: { kind: "source" },
      }),
      costValue.modifier({
        id: `${input.id.id}:cost`,
        target: input.target,
        mode: "add",
        amount: input.discount === 0 ? 0 : -input.discount,
        source: input.id,
        lifetime: { kind: "source" },
      }),
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
      attacker.health.hp === 0 ||
      attacker.combat.energy < cost ||
      state.activeFlows.includes(input.flowId)
    )
      throw Error("Cannot start combo");
    new WorldEditor(
      state.world,
      {
        objects: [],
        relations: [],
        components: [{ kind: "pet", component: "combat" }],
      },
      relations,
    ).setComponent(petCombat, input.source, {
      ...attacker.combat,
      energy: attacker.combat.energy - cost,
    });
    state.activeFlows.push(input.flowId);
    state.modifiers.push(
      attack.modifier({
        id: `${input.flowId}:attack`,
        target: input.source,
        mode: "multiply",
        amount: 1.2,
        source: input.source,
        lifetime: { kind: "flow", flowId: input.flowId },
      }),
    );
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
    attackParticipants(state, input.source, input.target);
    const random = nextRandom(state.rng, 3);
    state.rng = random.state;
    return applyDamage(
      state,
      input.source,
      input.target,
      effectiveAttack(state, input.source) + random.value,
      random.value,
    );
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
  ...strikeOperations,
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
    target: healableRef,
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
