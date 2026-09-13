import assert from "node:assert/strict";
import { test } from "node:test";
import {
  MemoryStore,
  openDurableSession,
  WorldQuery,
} from "@yuuinih/turn-kernel";
import {
  createPetDuel,
  petGame,
  type PetCommand,
} from "../src/pet-duel/game.js";
import { mark, pet } from "../src/pet-duel/model.js";
import { parseFact } from "../src/pet-duel/operations.js";

test("a new worker resumes a waiting combo, deduplicates the prior hit and fences the old worker", async () => {
  let now = 0;
  const store = new MemoryStore(() => now);
  const game = petGame("one");
  await store.create(createPetDuel("one").snapshot());
  const a = await openDurableSession(game, store, "one", "a", parseFact, 100);
  const attacker = pet.ref("one", "attacker");
  assert.ok(
    (
      await a.dispatch(
        {
          kind: "attach",
          id: mark.ref("one", "boost"),
          target: attacker,
          source: attacker,
          bonus: 5,
          discount: 3,
        },
        0,
        "buff",
      )
    ).ok,
  );
  const command: PetCommand = {
    kind: "combo",
    source: attacker,
    target: pet.ref("one", "defender"),
  };
  const result = await a.dispatch(command, 1, "combo");
  assert.ok(result.ok);
  const saved = await a.snapshot();
  assert.equal(saved.state.flow?.status, "waiting");
  now = 101;
  const b = await openDurableSession(game, store, "one", "b", parseFact);
  assert.deepEqual(await b.dispatch(command, 1, "combo"), result);
  assert.deepEqual(await b.snapshot(), saved);
  const prompt = saved.state.flow?.prompt;
  assert.ok(prompt);
  const choice: PetCommand = {
    kind: "choose",
    promptId: prompt.id,
    actor: "B",
    target: pet.ref("one", "reserve"),
  };
  assert.equal((await a.dispatch(choice, 2, "choice")).ok, false);
  assert.deepEqual(await b.snapshot(), saved);
  assert.ok((await b.dispatch(choice, 2, "choice")).ok);
  const done = await b.snapshot();
  assert.equal(done.revision, 3);
  assert.equal(done.state.flow?.status, "finished");
  assert.equal(
    new WorldQuery(done.state.battle.world).get(pet, pet.ref("one", "reserve"))
      .health.hp,
    10,
  );
});
