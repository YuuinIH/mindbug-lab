import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MemoryStore,
  openDurableSession,
  WorldQuery,
  WorldEditor,
} from "@yuuinih/turn-kernel";
import {
  createPetDuel,
  restorePetDuel,
  petGame,
  type PetCommand,
} from "../src/pet-duel/game.js";
import { pet, petCombat, petHealth, relations } from "../src/pet-duel/model.js";
import {
  strikeSettlement,
  parsePendingStrike,
} from "../src/pet-duel/strike-definition.js";
import { parseFact } from "../src/pet-duel/operations.js";
const attacker = pet.ref("one", "attacker"),
  target = pet.ref("one", "reserve");
const strike: PetCommand = { kind: "strike", source: attacker, target };
function prepare() {
  const game = createPetDuel("one");
  assert.ok(game.dispatch(strike, 0).ok);
  const saved = game.snapshot();
  const frame = saved.state.flow?.stack.at(-1),
    prompt = saved.state.flow?.prompt;
  assert.ok(frame);
  assert.ok(prompt);
  return {
    game,
    saved,
    frame,
    prompt,
    settlement: parsePendingStrike(frame.data),
  };
}
test("mid-damage wait restores sampled attack and random result; guard modifies only this settlement", () => {
  const { saved, prompt, settlement } = prepare();
  assert.equal(
    new WorldQuery(saved.state.battle.world).get(pet, target).health.hp,
    30,
  );
  const amount = strikeSettlement.read(settlement, "sampledDamage"),
    rng = saved.state.battle.rng;
  // A valid alternate world checkpoint demonstrates that resumption consumes the fixed sample.
  const world = saved.state.battle.world;
  const current = new WorldQuery(world).component(petCombat, attacker);
  new WorldEditor(
    world,
    {
      objects: [],
      relations: [],
      components: [{ kind: "pet", component: "combat" }],
    },
    relations,
  ).setComponent(petCombat, attacker, { ...current, attack: 100 });
  const restored = restorePetDuel("one", JSON.parse(JSON.stringify(saved)));
  const result = restored.dispatch(
    { kind: "respond", promptId: prompt.id, actor: "B", guard: true },
    1,
  );
  assert.ok(result.ok);
  const damage = result.facts.find((f) => f.kind === "damaged");
  assert.ok(damage && damage.kind === "damaged");
  assert.equal(damage.hpLost, Math.floor(amount * 0.5));
  assert.equal(restored.view().battle.rng, rng);
  assert.equal(
    new WorldQuery(restored.view().battle.world).get(pet, attacker).combat
      .attack,
    100,
  );
  assert.equal(
    new WorldQuery(restored.view().battle.world).get(pet, target).health.hp,
    30 - Math.floor(amount * 0.5),
  );
  const completed = strikeSettlement.parse(restored.view().flow?.result);
  assert.equal(completed.status, "completed");
  assert.equal(completed.modifiers.length, 1);
  assert.equal(
    restored.view().battle.modifiers.some((m) => m.id === "guard"),
    false,
  );
  assert.ok(restored.dispatch(strike, 2).ok);
  const nextFrame = restored.view().flow?.stack.at(-1);
  assert.ok(nextFrame);
  const next = parsePendingStrike(nextFrame.data);
  assert.notEqual(next.id, completed.id);
  assert.deepEqual(next.modifiers, []);
});
test("invalid choices, expired targets and corrupted intermediate checkpoints never commit", () => {
  const { game, saved, frame, prompt } = prepare();
  for (const command of [
    { kind: "respond", promptId: "old", actor: "B", guard: true },
    { kind: "respond", promptId: prompt.id, actor: "A", guard: true },
    { kind: "choose", promptId: prompt.id, actor: "B", target },
  ] satisfies PetCommand[]) {
    assert.equal(game.dispatch(command, 1).ok, false);
    assert.deepEqual(game.snapshot(), saved);
  }
  const invalid = structuredClone(saved);
  const corruptFrame = invalid.state.flow?.stack.at(-1);
  assert.ok(corruptFrame);
  const corrupt = parsePendingStrike(frame.data);
  corrupt.id = "another-hit";
  corruptFrame.data = corrupt;
  assert.throws(() => restorePetDuel("one", invalid), /another frame/);
  const defeated = structuredClone(saved);
  new WorldEditor(
    defeated.state.battle.world,
    {
      objects: [],
      relations: [],
      components: [{ kind: "pet", component: "health" }],
    },
    relations,
  ).setComponent(petHealth, target, { hp: 0, maxHp: 30, shield: 0 });
  const restored = restorePetDuel("one", defeated);
  assert.equal(
    restored.dispatch(
      { kind: "respond", promptId: prompt.id, actor: "B", guard: false },
      1,
    ).ok,
    false,
  );
  assert.deepEqual(restored.snapshot(), defeated);
});
test("another worker resumes the same pending damage and receipts prevent duplicate application", async () => {
  let now = 0;
  const store = new MemoryStore(() => now),
    game = petGame("one");
  await store.create(createPetDuel("one").snapshot());
  const a = await openDurableSession(game, store, "one", "a", parseFact, 100);
  const started = await a.dispatch(strike, 0, "strike");
  assert.ok(started.ok);
  const saved = await a.snapshot(),
    prompt = saved.state.flow?.prompt;
  assert.ok(prompt);
  now = 101;
  const b = await openDurableSession(game, store, "one", "b", parseFact);
  assert.deepEqual(await b.dispatch(strike, 0, "strike"), started);
  assert.deepEqual(await b.snapshot(), saved);
  const response: PetCommand = {
    kind: "respond",
    promptId: prompt.id,
    actor: "B",
    guard: true,
  };
  assert.equal((await a.dispatch(response, 1, "response")).ok, false);
  const result = await b.dispatch(response, 1, "response");
  assert.ok(result.ok);
  const done = await b.snapshot();
  assert.deepEqual(await b.dispatch(response, 1, "response"), result);
  assert.deepEqual(await b.snapshot(), done);
  assert.equal(done.state.flow?.status, "finished");
  assert.equal(done.state.battle.rng, saved.state.battle.rng);
});
