import { defineNumericValue, Evaluation, type Ref } from "@yuuinih/turn-kernel";
import type { Battle } from "./model.js";
import { petCombat } from "./definitions.js";
export const attack = defineNumericValue<Battle, "pet">(
  "attack",
  "1",
  "pet",
  (q, ref) => q.component(petCombat, ref, (state) => state.world).attack,
  (n) => Math.max(0, Math.floor(n)),
);
export const cost = defineNumericValue<Battle, "pet">(
  "cost",
  "1",
  "pet",
  (q, ref) => q.component(petCombat, ref, (state) => state.world).cost,
  (n) => Math.max(0, Math.floor(n)),
);
export const valueDefinitions = [attack, cost];
export function evaluate(battle: Battle) {
  return new Evaluation(battle, valueDefinitions, battle.modifiers);
}
export function effectiveAttack(battle: Battle, ref: Ref<"pet">): number {
  return evaluate(battle).read(attack, ref);
}
export function effectiveCost(battle: Battle, ref: Ref<"pet">): number {
  return evaluate(battle).read(cost, ref);
}
