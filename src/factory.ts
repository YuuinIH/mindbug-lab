import { z } from "zod";
import { createSession, restoreSession } from "@yuuinih/turn-kernel";
import type { Card, Player, State } from "./model.js";
import { gameFor } from "./game.js";
export function createMatch(
  matchId: string,
  definitions: unknown,
  inputDecks: unknown,
) {
  const game = gameFor(matchId, definitions);
  const deck = z.array(z.string().min(1)).length(10);
  const decks = z.strictObject({ A: deck, B: deck }).parse(inputDecks);
  const cards: Card[] = [];
  for (const player of ["A", "B"] satisfies Player[]) {
    decks[player].forEach((definition, index) =>
      cards.push({
        id: `${player}-${index}`,
        definition,
        controller: player,
        zone: index < 5 ? "hand" : "deck",
        exhausted: false,
      }),
    );
  }
  const state: State = {
    matchId,
    active: "A",
    players: { A: { life: 3, mindbugs: 2 }, B: { life: 3, mindbugs: 2 } },
    cards,
    flow: { kind: "action" },
  };
  return createSession(game, matchId, state);
}

export function restoreMatch(
  matchId: string,
  definitions: unknown,
  input: unknown,
) {
  const session = restoreSession(gameFor(matchId, definitions), input);
  if (session.snapshot().sessionId !== matchId)
    throw Error("Snapshot session mismatch");
  return session;
}
