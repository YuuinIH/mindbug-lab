import { defineFlow, type z } from "@yuuinih/turn-kernel";
import { strikeInput } from "./strike-definition.js";
import { damageHooks } from "./damage-hooks.js";
import { damage } from "./operations.js";
import type { Battle } from "./model.js";

/** A public hit boundary; its after reactions complete before the next combo hit. */
export const hitFlow = defineFlow<
  Battle,
  z.infer<typeof strikeInput>,
  z.infer<typeof strikeInput>
>({
  id: "hit",
  entry: "apply",
  input: strikeInput,
  result: strikeInput,
  hooks: damageHooks,
  steps: {
    apply: {
      parseData: (v) => strikeInput.parse(v),
      advance(_state, frame) {
        const input = strikeInput.parse(frame.data);
        return {
          kind: "done",
          result: input,
          operations: [damage.request(input)],
        };
      },
    },
  },
});
