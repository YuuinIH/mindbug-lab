import {
  z,
  WorldQuery,
  WorldEditor,
  type Ref,
  type OperationOutcome,
} from "@yuuinih/turn-kernel";
import { pet, petHealth, relations, type Battle } from "./model.js";
import type { Fact } from "./operations.js";
export function attackParticipants(
  state: Battle,
  source: Ref<"pet">,
  target: Ref<"pet">,
) {
  const query = new WorldQuery(state.world);
  const attacker = query.get(pet, source),
    defender = query.get(pet, target);
  if (
    attacker.health.hp === 0 ||
    defender.health.hp === 0 ||
    attacker.team === defender.team
  )
    throw Error("Invalid attack participants");
  return { attacker, defender };
}
/** A calculated amount is only a proposal; current participants and health are checked here. */
export function applyDamage(
  state: Battle,
  source: Ref<"pet">,
  target: Ref<"pet">,
  amount: number,
  rolled: number,
): OperationOutcome<Battle, Fact> {
  z.number().int().nonnegative().parse(amount);
  z.number().int().min(0).max(2).parse(rolled);
  const { defender } = attackParticipants(state, source, target);
  const absorbed = Math.min(defender.health.shield, amount);
  const hpLost = Math.min(defender.health.hp, amount - absorbed);
  new WorldEditor(
    state.world,
    {
      objects: [],
      relations: [],
      components: [{ kind: "pet", component: "health" }],
    },
    relations,
  ).setComponent(petHealth, target, {
    ...defender.health,
    shield: defender.health.shield - absorbed,
    hp: defender.health.hp - hpLost,
  });
  return {
    state,
    facts: [{ kind: "damaged", source, target, absorbed, hpLost, rolled }],
  };
}
