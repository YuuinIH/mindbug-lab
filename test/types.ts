import type { CardRef, CreatureRef, Command } from "../src/index.js";
const card: CardRef = { kind: "card", matchId: "one", id: "A-0" };
const creature: CreatureRef = { kind: "creature", matchId: "one", id: "A-0" };
// @ts-expect-error A hand-card reference cannot authorize a creature attack.
const invalidAttack: Command = { kind: "attack", actor: "A", creature: card };
// @ts-expect-error A creature reference cannot authorize playing from hand.
const invalidPlay: Command = { kind: "play", actor: "A", card: creature };
const invalidHeal: Command = {
  // @ts-expect-error Unknown operations are not part of this game's command vocabulary.
  kind: "heal",
  actor: "A",
  target: creature,
  amount: 1,
};
void [invalidAttack, invalidPlay, invalidHeal];
