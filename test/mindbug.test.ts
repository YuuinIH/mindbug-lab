import { test } from "node:test";
import assert from "node:assert/strict";
import { createMatch, restoreMatch, type Command } from "../src/index.js";

const definitions = [
  { id: "hunter", name: "Test hunter", power: 5, keywords: ["hunter"] },
  { id: "tough", name: "Test tough", power: 3, keywords: ["tough"] },
  { id: "plain", name: "Test plain", power: 4, keywords: [] },
  { id: "frenzy", name: "Test frenzy", power: 6, keywords: ["frenzy"] },
];
const decks = {
  A: Array<string>(10).fill("hunter"),
  B: Array<string>(10).fill("tough"),
};

test("takeover resumes from snapshot and gives the original player another turn", () => {
  const match = createMatch("one", definitions, decks);
  const play: Command = {
    kind: "play",
    actor: "A",
    card: { kind: "card", matchId: "one", id: "A-0" },
  };
  assert.equal(match.dispatch(play, 0).ok, true);
  assert.equal(match.view().flow.kind, "mindbug");
  assert.equal(
    match.view().cards.filter((c) => c.controller === "A" && c.zone === "hand")
      .length,
    5,
  );
  const saved = match.snapshot();
  const restored = restoreMatch(
    "one",
    definitions,
    JSON.parse(JSON.stringify(saved)),
  );
  const choice: Command = { kind: "mindbug", actor: "B", take: true };
  assert.equal(restored.dispatch(choice, 1).ok, true);
  assert.equal(restored.view().active, "A");
  assert.equal(restored.view().players.B.mindbugs, 1);
  assert.equal(
    restored.view().cards.find((c) => c.id === "A-0")?.controller,
    "B",
  );
  assert.equal(restored.dispatch(choice, 1).ok, false);
  assert.equal(match.dispatch(choice, 1).ok, true);
  assert.deepEqual(restored.snapshot(), match.snapshot());
});

function send(match: ReturnType<typeof createMatch>, command: Command) {
  const result = match.dispatch(command, match.snapshot().revision);
  assert.equal(result.ok, true, JSON.stringify(result));
  return result;
}
function ref(id: string) {
  return {
    kind: "creature",
    matchId: "one",
    id,
  } satisfies import("../src/index.js").CreatureRef;
}
function fieldMatch(a = "hunter", b = "tough") {
  const match = createMatch("one", definitions, {
    A: Array<string>(10).fill(a),
    B: Array<string>(10).fill(b),
  });
  send(match, {
    kind: "play",
    actor: "A",
    card: { kind: "card", matchId: "one", id: "A-0" },
  });
  send(match, { kind: "mindbug", actor: "B", take: false });
  send(match, {
    kind: "play",
    actor: "B",
    card: { kind: "card", matchId: "one", id: "B-0" },
  });
  send(match, { kind: "mindbug", actor: "A", take: false });
  return match;
}

test("Hunter forces the selected blocker; Tough replaces defeat exactly once", () => {
  const match = fieldMatch();
  const result = send(match, {
    kind: "attack",
    actor: "A",
    creature: ref("A-0"),
    target: ref("B-0"),
  });
  assert.equal(match.view().cards.find((c) => c.id === "B-0")?.zone, "field");
  assert.equal(match.view().cards.find((c) => c.id === "B-0")?.exhausted, true);
  if (result.ok)
    assert.equal(
      result.facts.some((f) => f.kind === "defeated"),
      false,
    );
  // Exhaustion does not stop a creature from attacking or blocking.
  send(match, { kind: "attack", actor: "B", creature: ref("B-0") });
  send(match, { kind: "block", actor: "A", blocker: null });
  send(match, {
    kind: "attack",
    actor: "A",
    creature: ref("A-0"),
    target: ref("B-0"),
  });
  assert.equal(match.view().cards.find((c) => c.id === "B-0")?.zone, "discard");
});

test("illegal actor, zone, kind, Hunter target and cross-match reference leave snapshot unchanged", () => {
  const match = fieldMatch("plain", "plain");
  const commands: unknown[] = [
    { kind: "attack", actor: "B", creature: ref("B-0") },
    { kind: "attack", actor: "A", creature: ref("B-0") },
    { kind: "attack", actor: "A", creature: ref("A-1") },
    {
      kind: "attack",
      actor: "A",
      creature: { kind: "card", matchId: "one", id: "A-0" },
    },
    {
      kind: "attack",
      actor: "A",
      creature: { ...ref("A-0"), matchId: "other" },
    },
    { kind: "attack", actor: "A", creature: ref("A-0"), target: ref("B-0") },
    { kind: "heal", actor: "A", target: ref("A-0"), amount: 5 },
  ];
  const saved = match.snapshot();
  for (const command of commands) {
    assert.equal(
      match.submit({ sessionId: "one", revision: saved.revision, command }).ok,
      false,
    );
    assert.deepEqual(match.snapshot(), saved);
  }
});

test("block waiting state restores, rejects the wrong chooser and invalid blockers", () => {
  const original = fieldMatch();
  send(original, { kind: "attack", actor: "A", creature: ref("A-0") });
  const match = restoreMatch(
    "one",
    definitions,
    JSON.parse(JSON.stringify(original.snapshot())),
  );
  const saved = match.snapshot();
  for (const command of [
    { kind: "block", actor: "A", blocker: null },
    { kind: "block", actor: "B", blocker: ref("A-0") },
    { kind: "block", actor: "B", blocker: ref("B-1") },
    {
      kind: "play",
      actor: "A",
      card: { kind: "card", matchId: "one", id: "A-1" },
    },
  ] satisfies Command[]) {
    assert.equal(match.dispatch(command, saved.revision).ok, false);
    assert.deepEqual(match.snapshot(), saved);
  }
  send(match, { kind: "block", actor: "B", blocker: ref("B-0") });
  send(original, { kind: "block", actor: "B", blocker: ref("B-0") });
  assert.deepEqual(match.snapshot(), original.snapshot());
});

test("Frenzy survives save/restore and permits only a second attack", () => {
  const original = fieldMatch("frenzy", "plain");
  send(original, { kind: "attack", actor: "A", creature: ref("A-0") });
  send(original, { kind: "block", actor: "B", blocker: null });
  assert.equal(original.view().flow.kind, "frenzy");
  const match = restoreMatch("one", definitions, original.snapshot());
  send(match, { kind: "frenzy", actor: "A", again: true });
  const resumed = restoreMatch("one", definitions, match.snapshot());
  send(resumed, { kind: "block", actor: "B", blocker: null });
  assert.equal(resumed.view().players.B.life, 1);
  assert.equal(resumed.view().active, "B");
  assert.equal(resumed.view().flow.kind, "action");
  assert.equal(
    resumed.dispatch(
      { kind: "frenzy", actor: "A", again: true },
      resumed.snapshot().revision,
    ).ok,
    false,
  );
});

test("Frenzy may be declined; a defeated Frenzy attacker cannot attack again", () => {
  const match = fieldMatch("frenzy", "plain");
  send(match, { kind: "attack", actor: "A", creature: ref("A-0") });
  send(match, { kind: "block", actor: "B", blocker: null });
  send(match, { kind: "frenzy", actor: "A", again: false });
  assert.equal(match.view().active, "B");
  const tie = fieldMatch("frenzy", "frenzy");
  send(tie, { kind: "attack", actor: "A", creature: ref("A-0") });
  send(tie, { kind: "block", actor: "B", blocker: ref("B-0") });
  assert.equal(tie.view().flow.kind, "action");
  assert.equal(tie.view().cards.filter((c) => c.zone === "discard").length, 2);
});

test("zero life terminates immediately and refuses further input, including after restoration", () => {
  const match = fieldMatch("frenzy", "plain");
  send(match, { kind: "attack", actor: "A", creature: ref("A-0") });
  send(match, { kind: "block", actor: "B", blocker: null });
  send(match, { kind: "frenzy", actor: "A", again: true });
  send(match, { kind: "block", actor: "B", blocker: null });
  send(match, { kind: "attack", actor: "B", creature: ref("B-0") });
  send(match, { kind: "block", actor: "A", blocker: null });
  send(match, { kind: "attack", actor: "A", creature: ref("A-0") });
  send(match, { kind: "block", actor: "B", blocker: null });
  assert.deepEqual(match.view().flow, {
    kind: "finished",
    winner: "A",
    reason: "life",
  });
  const restored = restoreMatch("one", definitions, match.snapshot());
  const saved = restored.snapshot();
  assert.equal(
    restored.dispatch(
      { kind: "frenzy", actor: "A", again: true },
      saved.revision,
    ).ok,
    false,
  );
  assert.deepEqual(restored.snapshot(), saved);
});

test("snapshot validation rejects duplicate IDs, missing references, inconsistent flow and changed ruleset", () => {
  const match = fieldMatch();
  const duplicate = match.snapshot();
  const first = duplicate.state.cards[0];
  const second = duplicate.state.cards[1];
  assert.ok(first && second);
  second.id = first.id;
  assert.throws(() => restoreMatch("one", definitions, duplicate));
  const missing = match.snapshot();
  missing.state.flow = { kind: "block", attackerId: "absent", attackNumber: 1 };
  assert.throws(() => restoreMatch("one", definitions, missing));
  const invalidFrenzy = match.snapshot();
  invalidFrenzy.state.flow = { kind: "frenzy", attackerId: "A-0" };
  assert.throws(() => restoreMatch("one", definitions, invalidFrenzy));
  assert.throws(() => restoreMatch("other", definitions, match.snapshot()));
  assert.throws(() =>
    restoreMatch(
      "one",
      definitions.map((d) => ({ ...d, power: d.power + 1 })),
      match.snapshot(),
    ),
  );
  assert.throws(() =>
    restoreMatch("one", definitions, { ...match.snapshot(), revision: -1 }),
  );
});

test("no-action loss and exhausted Mindbug supply are handled", () => {
  const match = fieldMatch();
  const saved = match.snapshot();
  // Valid scenario fixture: B has lost every card and cannot take their next turn.
  for (const card of saved.state.cards)
    if (card.controller === "B") card.zone = "discard";
  const restored = restoreMatch("one", definitions, saved);
  send(restored, { kind: "attack", actor: "A", creature: ref("A-0") });
  send(restored, { kind: "block", actor: "B", blocker: null });
  assert.deepEqual(restored.view().flow, {
    kind: "finished",
    winner: "A",
    reason: "no-actions",
  });
  const empty = match.snapshot();
  empty.state.players.B.mindbugs = 0;
  const noMindbugs = restoreMatch("one", definitions, empty);
  send(noMindbugs, {
    kind: "play",
    actor: "A",
    card: { kind: "card", matchId: "one", id: "A-1" },
  });
  assert.equal(noMindbugs.view().flow.kind, "action");
  assert.equal(noMindbugs.view().active, "B");
});

test("content validation rejects missing and duplicate definitions and nonfinite power", () => {
  assert.throws(() =>
    createMatch("one", definitions, {
      A: Array<string>(10).fill("missing"),
      B: decks.B,
    }),
  );
  assert.throws(() =>
    createMatch("one", [...definitions, definitions[0]], decks),
  );
  assert.throws(() =>
    createMatch(
      "one",
      [{ id: "hunter", name: "bad", power: Infinity, keywords: [] }],
      decks,
    ),
  );
});

test("multiple generated full games restore every decision and eventually terminate", () => {
  for (let run = 0; run < 12; run += 1) {
    const pool = ["hunter", "tough", "plain", "frenzy"];
    const buildDeck = (offset: number) =>
      Array.from(
        { length: 10 },
        (_, i) => pool[(i + offset) % pool.length] ?? "plain",
      );
    let match = createMatch("one", definitions, {
      A: buildDeck(run),
      B: buildDeck(run + 1),
    });
    for (
      let step = 0;
      step < 200 && match.view().flow.kind !== "finished";
      step += 1
    ) {
      const state = match.view();
      const active = state.active;
      const opponent = active === "A" ? "B" : "A";
      let command: Command;
      switch (state.flow.kind) {
        case "action": {
          const inPlay = state.cards.find(
            (c) => c.zone === "field" && c.controller === active,
          );
          const inHand = state.cards.find(
            (c) => c.zone === "hand" && c.controller === active,
          );
          if (inPlay && (step % 3 !== 0 || !inHand))
            command = {
              kind: "attack",
              actor: active,
              creature: ref(inPlay.id),
            };
          else {
            assert.ok(inHand);
            command = {
              kind: "play",
              actor: active,
              card: { kind: "card", matchId: "one", id: inHand.id },
            };
          }
          break;
        }
        case "mindbug":
          command = {
            kind: "mindbug",
            actor: opponent,
            take: (step + run) % 2 === 0,
          };
          break;
        case "block": {
          const blocker = state.cards.find(
            (c) => c.zone === "field" && c.controller === opponent,
          );
          command = {
            kind: "block",
            actor: opponent,
            blocker: blocker && step % 3 !== 0 ? ref(blocker.id) : null,
          };
          break;
        }
        case "frenzy":
          command = { kind: "frenzy", actor: active, again: true };
          break;
        case "finished":
          throw Error("Unexpected finished loop");
      }
      const restored = restoreMatch(
        "one",
        definitions,
        JSON.parse(JSON.stringify(match.snapshot())),
      );
      const revision = match.snapshot().revision;
      const expected = match.dispatch(command, revision);
      const actual = restored.dispatch(command, revision);
      assert.equal(expected.ok, true, JSON.stringify(expected));
      assert.deepEqual(actual, expected);
      assert.deepEqual(restored.snapshot(), match.snapshot());
      assert.equal(restored.dispatch(command, revision).ok, false);
      match = restored;
    }
    assert.equal(match.view().flow.kind, "finished", `run ${run} must finish`);
  }
});

test("the no-healing/no-extra-draw subset rejects excess life and oversized hands", () => {
  const match = fieldMatch();
  const excessLife = match.snapshot();
  excessLife.state.players.A.life = 999;
  assert.throws(() => restoreMatch("one", definitions, excessLife));
  const excessHand = match.snapshot();
  const card = excessHand.state.cards.find(
    (c) => c.zone === "deck" && c.controller === "A",
  );
  assert.ok(card);
  card.zone = "hand";
  assert.throws(() => restoreMatch("one", definitions, excessHand));
});
