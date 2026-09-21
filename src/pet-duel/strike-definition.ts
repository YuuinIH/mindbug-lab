import { defineSettlement, z } from "@yuuinih/turn-kernel";
import { pet } from "./definitions.js";
export const strikeInput = z.strictObject({
  source: z.unknown().transform(pet.parseRef),
  target: z.unknown().transform(pet.parseRef),
});
export const strikeSettlement = defineSettlement({
  id: "strike-damage",
  input: strikeInput.extend({
    attack: z.number().int().nonnegative(),
    rolled: z.number().int().min(0).max(2),
    team: z.enum(["A", "B"]),
  }),
  stages: ["sample", "defense"],
  values: {
    sampledDamage: {
      stage: "sample",
      constrain: (n: number) => Math.max(0, Math.floor(n)),
    },
    incomingDamage: {
      stage: "defense",
      constrain: (n: number) => Math.max(0, Math.floor(n)),
    },
  },
});
export function parsePendingStrike(input: unknown) {
  const s = strikeSettlement.parse(input);
  if (s.modifiers.length !== 0)
    throw Error("Unexpected pending strike modifier");
  if (s.status !== "open" || s.stage !== 1)
    throw Error("Expected pending defense settlement");
  if (
    s.input.source.sessionId !== s.sessionId ||
    s.input.target.sessionId !== s.sessionId
  )
    throw Error("Foreign strike participants");
  if (
    strikeSettlement.read(s, "sampledDamage") !==
    s.input.attack + s.input.rolled
  )
    throw Error("Strike sample mismatch");
  const incoming = s.values.incomingDamage;
  if (!incoming || incoming.base !== strikeSettlement.read(s, "sampledDamage"))
    throw Error("Strike damage input mismatch");
  return s;
}
