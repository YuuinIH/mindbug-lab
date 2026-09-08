import { z } from "@yuuinih/turn-kernel";
import {
  activeModifiers,
  defineObject,
  defineRelation,
  parseModifier,
  sameRef,
  worldParser,
  type NumericModifier,
  type World,
} from "@yuuinih/turn-kernel";
const petSchema = z
  .strictObject({
    hp: z.number().int().min(0),
    maxHp: z.number().int().positive(),
    attack: z.number().int().min(0),
    cost: z.number().int().min(0),
    energy: z.number().int().min(0),
    shield: z.number().int().min(0),
    team: z.enum(["A", "B"]),
  })
  .refine((p) => p.hp <= p.maxHp, "HP exceeds maximum");
const markSchema = z.strictObject({
  stacks: z.number().int().positive(),
  bonus: z.number().int(),
  discount: z.number().int().min(0),
});
export const pet = defineObject("pet", "1", petSchema);
export const mark = defineObject("mark", "1", markSchema);
export const attached = defineRelation({
  id: "attached",
  version: "1",
  from: "mark",
  to: "pet",
  cardinality: "one",
  required: true,
  acyclic: true,
  onTargetDelete: "cascade",
});
export const source = defineRelation({
  id: "source",
  version: "1",
  from: "mark",
  to: "pet",
  cardinality: "one",
  required: false,
  acyclic: true,
  onTargetDelete: "detach",
});
export const relations = [attached, source];
export const parseWorld = worldParser([pet, mark], relations);
export interface Battle {
  world: World;
  modifiers: NumericModifier[];
  rng: number;
  activeFlows: string[];
}
const battleSchema = z.strictObject({
  world: z.unknown(),
  modifiers: z.array(z.unknown()),
  rng: z.number().int().min(0).max(0xffffffff),
  activeFlows: z.array(z.string().min(1)),
});
export function parseBattle(input: unknown): Battle {
  const v = battleSchema.parse(input);
  const world = parseWorld(v.world);
  const modifiers = v.modifiers.map(parseModifier);
  if (
    new Set(v.activeFlows).size !== v.activeFlows.length ||
    new Set(modifiers.map((m) => m.id)).size !== modifiers.length
  )
    throw Error("Duplicate lifetime/modifier");
  if (
    activeModifiers(
      modifiers,
      world.entities.map((e) => e.ref),
      v.activeFlows,
    ).length !== modifiers.length
  )
    throw Error("Expired modifier in checkpoint");
  for (const modifier of modifiers) {
    if (
      modifier.target.kind !== "pet" ||
      !["attack", "cost"].includes(modifier.valueId)
    )
      throw Error("Modifier value is not available on this object");
  }
  return { world, modifiers, rng: v.rng, activeFlows: v.activeFlows };
}
export function prune(battle: Battle): void {
  battle.modifiers = activeModifiers(
    battle.modifiers,
    battle.world.entities.map((e) => e.ref),
    battle.activeFlows,
  );
}
export function initialBattle(sessionId: string): Battle {
  return parseBattle({
    world: {
      sessionId,
      retiredIds: [],
      relations: [],
      entities: [
        {
          ref: pet.ref(sessionId, "attacker"),
          value: {
            hp: 20,
            maxHp: 30,
            attack: 10,
            cost: 8,
            energy: 20,
            shield: 0,
            team: "A",
          },
        },
        {
          ref: pet.ref(sessionId, "defender"),
          value: {
            hp: 5,
            maxHp: 30,
            attack: 5,
            cost: 5,
            energy: 10,
            shield: 3,
            team: "B",
          },
        },
        {
          ref: pet.ref(sessionId, "reserve"),
          value: {
            hp: 30,
            maxHp: 30,
            attack: 5,
            cost: 5,
            energy: 10,
            shield: 0,
            team: "B",
          },
        },
      ],
    },
    modifiers: [],
    rng: 123,
    activeFlows: [],
  });
}
export function assertSameIdentities(a: Battle, b: Battle): void {
  if (a.world.sessionId !== b.world.sessionId)
    throw Error("Session write denied");
  for (const entity of a.world.entities) {
    const next = b.world.entities.find((e) => e.ref.id === entity.ref.id);
    if (next && !sameRef(entity.ref, next.ref))
      throw Error("Identity change denied");
  }
}
