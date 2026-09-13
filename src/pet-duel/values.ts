import { Evaluation, type Ref } from "@yuuinih/turn-kernel";
import type { Battle } from "./model.js";
import { petCombat } from "./definitions.js";
export const attack = petCombat.numericValue<Battle>(
  "attack",
  "1",
  (_q, _ref, combat) => combat.attack,
  (n) => Math.max(0, Math.floor(n)),
);
export const cost = petCombat.numericValue<Battle>(
  "cost",
  "1",
  (_q, _ref, combat) => combat.cost,
  (n) => Math.max(0, Math.floor(n)),
);
export const valueDefinitions = [attack, cost];
export function evaluate(battle: Battle) {
  return new Evaluation(
    battle,
    (state) => state.world,
    valueDefinitions,
    battle.modifiers,
  );
}
export function effectiveAttack(battle: Battle, ref: Ref<"pet">): number {
  return evaluate(battle).read(attack, ref);
}
export function effectiveCost(battle: Battle, ref: Ref<"pet">): number {
  return evaluate(battle).read(cost, ref);
}
