import {
  content,
  defineObject,
  defineRelation,
  registration,
  RulesetBuilder,
  validateRelations,
  type Relation,
} from "@yuuinih/turn-kernel";
import { definitionsSchema, stateSchema, type State } from "./model.js";
export const cardType = defineObject(
  "card",
  "1",
  stateSchema.shape.cards.element,
);
export const playerType = defineObject(
  "player",
  "1",
  stateSchema.shape.players.shape.A,
);
export const controlledBy = defineRelation({
  id: "controlled-by",
  version: "1",
  from: "card",
  to: "player",
  cardinality: "one",
  required: true,
  acyclic: true,
  onTargetDelete: "restrict",
});
export function validateControlRelations(state: State): void {
  const players = [
    playerType.ref(state.matchId, "A"),
    playerType.ref(state.matchId, "B"),
  ];
  const cards = state.cards.map((c) => cardType.ref(state.matchId, c.id));
  const relations: Relation[] = state.cards.map((c) => ({
    id: `control:${c.id}`,
    type: controlledBy.id,
    from: cardType.ref(state.matchId, c.id),
    to: playerType.ref(state.matchId, c.controller),
  }));
  validateRelations([...players, ...cards], relations, [controlledBy]);
}
export function registerContent(input: unknown) {
  const cards = content("cards", input, (value) =>
    definitionsSchema.parse(value),
  );
  const builder = new RulesetBuilder()
    .add(registration("object", "card", "1", cardType))
    .add(registration("object", "player", "1", playerType))
    .add(
      registration("relation", controlledBy.id, "1", controlledBy, [
        "object:card",
        "object:player",
      ]),
    )
    .add(cards);
  return { cards, builder };
}
