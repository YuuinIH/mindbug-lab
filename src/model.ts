import { z } from "zod";

const player = z.enum(["A", "B"]);
const id = z.string().min(1).max(100);
// This subset has no life-gain effects; expand this bound when adding those rules.
const life = z.number().int().min(0).max(3);
export const definitionsSchema = z
  .array(
    z.strictObject({
      id,
      name: z.string().min(1),
      power: z.number().int().min(1).max(1000),
      keywords: z.array(z.enum(["hunter", "tough", "frenzy"])),
    }),
  )
  .min(1)
  .superRefine((definitions, context) => {
    if (new Set(definitions.map((d) => d.id)).size !== definitions.length) {
      context.addIssue({ code: "custom", message: "Duplicate definition ID" });
    }
  });
export type Definition = z.infer<typeof definitionsSchema>[number];
export type Player = z.infer<typeof player>;
const cardRef = z.strictObject({ kind: z.literal("card"), matchId: id, id });
const creatureRef = z.strictObject({
  kind: z.literal("creature"),
  matchId: id,
  id,
});
export type CardRef = z.infer<typeof cardRef>;
export type CreatureRef = z.infer<typeof creatureRef>;

export const commandSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("play"), actor: player, card: cardRef }),
  z.strictObject({
    kind: z.literal("mindbug"),
    actor: player,
    take: z.boolean(),
  }),
  z.strictObject({
    kind: z.literal("attack"),
    actor: player,
    creature: creatureRef,
    target: creatureRef.optional(),
  }),
  z.strictObject({
    kind: z.literal("block"),
    actor: player,
    blocker: creatureRef.nullable(),
  }),
  z.strictObject({
    kind: z.literal("frenzy"),
    actor: player,
    again: z.boolean(),
    target: creatureRef.optional(),
  }),
]);
export type Command = z.infer<typeof commandSchema>;

const flow = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("action") }),
  z.strictObject({ kind: z.literal("mindbug"), cardId: id }),
  z.strictObject({
    kind: z.literal("block"),
    attackerId: id,
    attackNumber: z.union([z.literal(1), z.literal(2)]),
  }),
  z.strictObject({ kind: z.literal("frenzy"), attackerId: id }),
  z.strictObject({
    kind: z.literal("finished"),
    winner: player,
    reason: z.enum(["life", "no-actions"]),
  }),
]);
const playerState = z.strictObject({
  life,
  mindbugs: z.number().int().min(0).max(2),
});
export const stateSchema = z.strictObject({
  matchId: id,
  active: player,
  players: z.strictObject({ A: playerState, B: playerState }),
  cards: z
    .array(
      z.strictObject({
        id,
        definition: id,
        controller: player,
        zone: z.enum(["deck", "hand", "pending", "field", "discard"]),
        exhausted: z.boolean(),
      }),
    )
    .length(20),
  flow,
});
export type State = z.infer<typeof stateSchema>;
export type Card = State["cards"][number];
export type Fact =
  | { kind: "offered"; cardId: string; player: Player }
  | { kind: "entered"; cardId: string; controller: Player; taken: boolean }
  | { kind: "attacked"; cardId: string; number: 1 | 2 }
  | { kind: "exhausted" | "defeated"; cardId: string }
  | { kind: "life-lost"; player: Player; life: number }
  | { kind: "turn"; player: Player }
  | { kind: "finished"; winner: Player };

export function other(player: Player): Player {
  return player === "A" ? "B" : "A";
}
