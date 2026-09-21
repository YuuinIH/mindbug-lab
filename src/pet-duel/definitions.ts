import {
  z,
  defineComponent,
  componentTarget,
  defineObject,
  defineRelation,
  worldParser,
} from "@yuuinih/turn-kernel";
export const health = defineComponent(
  "health",
  z
    .strictObject({
      hp: z.number().int().min(0),
      maxHp: z.number().int().positive(),
      shield: z.number().int().min(0),
    })
    .refine((v) => v.hp <= v.maxHp, "HP exceeds maximum"),
);
export const combat = defineComponent(
  "combat",
  z.strictObject({
    attack: z.number().int().min(0),
    cost: z.number().int().min(0),
    energy: z.number().int().min(0),
  }),
);
export const pet = defineObject(
  "pet",
  z.strictObject({
    health: health.schema(),
    combat: combat.schema(),
    team: z.enum(["A", "B"]),
  }),
  [health.slot("health"), combat.slot("combat")],
);
export const tower = defineObject(
  "tower",
  z.strictObject({
    health: health.schema(),
    team: z.enum(["A", "B"]),
  }),
  [health.slot("health")],
);
export const mark = defineObject(
  "mark",
  z.strictObject({
    stacks: z.number().int().positive(),
    bonus: z.number().int(),
    discount: z.number().int().min(0),
  }),
);
export const healable = componentTarget(health, pet, tower);
export const petHealth = componentTarget(health, pet);
export const petCombat = componentTarget(combat, pet);
export const attached = defineRelation({
  id: "attached",
  from: "mark",
  to: { component: health.id },
  cardinality: "one",
  required: true,
  acyclic: true,
  onTargetDelete: "cascade",
});
export const source = defineRelation({
  id: "source",
  from: "mark",
  to: "pet",
  cardinality: "one",
  required: false,
  acyclic: true,
  onTargetDelete: "detach",
});
export const relations = [attached, source];
export const objectDefinitions = [pet, tower, mark];
export const componentDefinitions = [health, combat];
export const parseWorld = worldParser(objectDefinitions, relations);
