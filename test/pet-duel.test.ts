import { test } from "node:test";
import assert from "node:assert/strict";
import { WorldQuery } from "@yuuinih/turn-kernel";
import {
  createPetDuel,
  restorePetDuel,
  type PetCommand,
} from "../src/pet-duel/game.js";
import { mark, pet } from "../src/pet-duel/model.js";
import { effectiveAttack, effectiveCost } from "../src/pet-duel/values.js";
function send(session: ReturnType<typeof createPetDuel>, command: PetCommand) {
  const result = session.dispatch(command, session.snapshot().revision);
  assert.equal(result.ok, true, JSON.stringify(result));
  return result;
}
const attacker = pet.ref("one", "attacker");
const defender = pet.ref("one", "defender");
const reserve = pet.ref("one", "reserve");
const boost = mark.ref("one", "boost");
function buffed() {
  const session = createPetDuel("one");
  send(session, {
    kind: "attach",
    id: boost,
    target: attacker,
    source: attacker,
    bonus: 5,
    discount: 3,
  });
  return session;
}
test("same field/value infrastructure computes attack and cost; removing source removes its contributions", () => {
  const session = buffed();
  assert.equal(effectiveAttack(session.view().battle, attacker), 15);
  assert.equal(effectiveCost(session.view().battle, attacker), 5);
  const restored = restorePetDuel(
    "one",
    JSON.parse(JSON.stringify(session.snapshot())),
  );
  assert.equal(effectiveAttack(restored.view().battle, attacker), 15);
  send(restored, { kind: "remove", target: boost });
  assert.equal(effectiveAttack(restored.view().battle, attacker), 10);
  assert.equal(effectiveCost(restored.view().battle, attacker), 8);
  assert.equal(restored.view().battle.world.relations.length, 0);
  assert.equal(restored.view().battle.modifiers.length, 0);
});
test("mark healing, stale refs and foreign targets fail without any write", () => {
  const session = buffed();
  const saved = session.snapshot();
  for (const target of [
    boost,
    { kind: "pet", sessionId: "one", id: "boost" },
    pet.ref("other", "attacker"),
  ]) {
    assert.equal(
      session.submit({
        sessionId: "one",
        revision: saved.revision,
        command: { kind: "heal", target, amount: 4 },
      }).ok,
      false,
    );
    assert.deepEqual(session.snapshot(), saved);
  }
  send(session, { kind: "heal", target: attacker, amount: 4 });
  assert.equal(
    new WorldQuery(session.view().battle.world).get(pet, attacker).hp,
    24,
  );
  assert.equal(
    new WorldQuery(session.view().battle.world).get(mark, boost).stacks,
    1,
  );
});
test("two hits recalculate attributes after reactions, wait for replacement, restore and expire flow modifiers", () => {
  const session = buffed();
  const first = send(session, {
    kind: "combo",
    source: attacker,
    target: defender,
  });
  assert.equal(session.view().flow?.status, "waiting");
  assert.equal(
    new WorldQuery(session.view().battle.world).get(pet, attacker).energy,
    15,
  );
  assert.deepEqual(
    new WorldQuery(session.view().battle.world).get(pet, defender),
    {
      hp: 0,
      maxHp: 30,
      attack: 5,
      cost: 5,
      energy: 10,
      shield: 0,
      team: "B",
    },
  );
  if (first.ok) {
    const damage = first.facts.find((f) => f.kind === "damaged");
    assert.ok(damage && damage.kind === "damaged");
    assert.equal(damage.absorbed, 3);
    assert.equal(damage.hpLost, 5);
  }
  assert.equal(effectiveAttack(session.view().battle, attacker), 20);
  const saved = session.snapshot();
  const restored = restorePetDuel("one", JSON.parse(JSON.stringify(saved)));
  const prompt = restored.view().flow?.prompt;
  assert.ok(prompt);
  for (const command of [
    { kind: "choose", promptId: prompt.id, actor: "A", target: reserve },
    { kind: "choose", promptId: "old", actor: "B", target: reserve },
    { kind: "choose", promptId: prompt.id, actor: "B", target: attacker },
    { kind: "choose", promptId: prompt.id, actor: "B", target: defender },
    { kind: "heal", target: attacker, amount: 1 },
  ] satisfies PetCommand[]) {
    assert.equal(restored.dispatch(command, saved.revision).ok, false);
    assert.deepEqual(restored.snapshot(), saved);
  }
  const command: PetCommand = {
    kind: "choose",
    promptId: prompt.id,
    actor: "B",
    target: reserve,
  };
  const a = send(restored, command);
  const b = send(session, command);
  assert.deepEqual(a, b);
  assert.deepEqual(restored.snapshot(), session.snapshot());
  assert.equal(restored.view().flow?.status, "finished");
  assert.deepEqual(restored.view().battle.activeFlows, []);
  assert.equal(
    restored.view().battle.modifiers.some((m) => m.lifetime.kind === "flow"),
    false,
  );
  assert.equal(
    new WorldQuery(restored.view().battle.world).get(pet, reserve).hp,
    10,
  );
  assert.equal(effectiveAttack(restored.view().battle, attacker), 19);
  assert.equal(restored.dispatch(command, saved.revision).ok, false);
});
test("invalid modifier and orphaned scope snapshots are rejected", () => {
  const session = buffed();
  const bad = session.snapshot();
  const modifier = bad.state.battle.modifiers[0];
  assert.ok(modifier);
  modifier.target = boost;
  assert.throws(() => restorePetDuel("one", bad));
  const orphan = session.snapshot();
  orphan.state.battle.activeFlows.push("missing");
  assert.throws(() => restorePetDuel("one", orphan));
});
// @ts-expect-error A mark cannot be assigned as a healing target.
const invalidHeal: PetCommand = { kind: "heal", target: boost, amount: 1 };
void invalidHeal;

test("invalid combo fails without creating a fault flow or blocking later legal commands", () => {
  const session = createPetDuel("one");
  const saved = session.snapshot();
  for (const command of [
    { kind: "combo", source: attacker, target: attacker },
    { kind: "combo", source: pet.ref("one", "missing"), target: defender },
    { kind: "combo", source: attacker, target: pet.ref("other", "defender") },
  ] satisfies PetCommand[]) {
    assert.equal(session.dispatch(command, saved.revision).ok, false);
    assert.deepEqual(session.snapshot(), saved);
  }
  send(session, { kind: "heal", target: attacker, amount: 1 });
  assert.equal(
    new WorldQuery(session.view().battle.world).get(pet, attacker).hp,
    21,
  );
});
