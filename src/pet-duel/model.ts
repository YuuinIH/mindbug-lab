import { pet, tower, parseWorld } from "./definitions.js";
import { valueDefinitions } from "./values.js";
export * from "./definitions.js";
import { z } from "@yuuinih/turn-kernel";
import {
  activeModifiers,
  validateModifiers,
  sameRef,
  type NumericModifier,
  type World,
} from "@yuuinih/turn-kernel";
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
  if (new Set(v.activeFlows).size !== v.activeFlows.length)
    throw Error("Duplicate flow scope");
  const modifiers = validateModifiers(
    v.modifiers,
    valueDefinitions,
    world,
    v.activeFlows,
  );
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
          ref: tower.ref(sessionId, "tower"),
          value: { health: { hp: 10, maxHp: 40, shield: 0 }, team: "A" },
        },
        {
          ref: pet.ref(sessionId, "attacker"),
          value: {
            health: { hp: 20, maxHp: 30, shield: 0 },
            combat: { attack: 10, cost: 8, energy: 20 },
            team: "A",
          },
        },
        {
          ref: pet.ref(sessionId, "defender"),
          value: {
            health: { hp: 5, maxHp: 30, shield: 3 },
            combat: { attack: 5, cost: 5, energy: 10 },
            team: "B",
          },
        },
        {
          ref: pet.ref(sessionId, "reserve"),
          value: {
            health: { hp: 30, maxHp: 30, shield: 0 },
            combat: { attack: 5, cost: 5, energy: 10 },
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
