import type { Card, Definition, Player, State } from "./model.js";
export function createRules(definitions: readonly Definition[]) {
  const byId = new Map(definitions.map((d) => [d.id, d]));
  function definition(card: Card): Definition {
    const found = byId.get(card.definition);
    if (!found) throw Error("Missing definition");
    return found;
  }
  function has(card: Card, keyword: Definition["keywords"][number]): boolean {
    return definition(card).keywords.includes(keyword);
  }
  function canAct(state: State, actor: Player): boolean {
    return state.cards.some(
      (c) =>
        c.controller === actor && (c.zone === "hand" || c.zone === "field"),
    );
  }
  return { definition, has, canAct };
}
export type Rules = ReturnType<typeof createRules>;
