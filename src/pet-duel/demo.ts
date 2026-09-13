import assert from "node:assert/strict";
import {
  MemoryStore,
  openDurableSession,
  WorldQuery,
} from "@yuuinih/turn-kernel";
import { createPetDuel, petGame } from "./game.js";
import { mark, pet } from "./model.js";
import { parseFact } from "./operations.js";
import { effectiveAttack, effectiveCost } from "./values.js";

// The clock makes worker takeover reproducible without a real timer.
let now = 0;
const store = new MemoryStore(() => now);
const id = "demo";
const game = petGame(id);
await store.create(createPetDuel(id).snapshot());
const first = await openDurableSession(
  game,
  store,
  id,
  "worker-a",
  parseFact,
  100,
);
const attacker = pet.ref(id, "attacker");
const defender = pet.ref(id, "defender");
const reserve = pet.ref(id, "reserve");
const buff = await first.dispatch(
  {
    kind: "attach",
    id: mark.ref(id, "boost"),
    source: attacker,
    target: attacker,
    bonus: 5,
    discount: 3,
  },
  0,
  "buff",
);
assert.ok(buff.ok);
const boosted = (await first.snapshot()).state.battle;
console.log(
  "附着印记：攻击",
  effectiveAttack(boosted, attacker),
  "，费用",
  effectiveCost(boosted, attacker),
);
const command = {
  kind: "combo",
  source: attacker,
  target: defender,
} satisfies import("./game.js").PetCommand;
const hit = await first.dispatch(command, 1, "combo");
assert.ok(hit.ok);
const checkpoint = await first.snapshot();
assert.equal(checkpoint.state.flow?.status, "waiting");
console.log(
  "首击消耗护盾并击倒目标，等待 B 选择替补；归档版本",
  checkpoint.revision,
);

now = 101;
const second = await openDurableSession(game, store, id, "worker-b", parseFact);
assert.deepEqual(await second.dispatch(command, 1, "combo"), hit);
assert.deepEqual(await second.snapshot(), checkpoint);
console.log("新工作进程接管；重试已提交请求返回原结果，不重复结算。");
const prompt = checkpoint.state.flow?.prompt;
assert.ok(prompt);
const result = await second.dispatch(
  { kind: "choose", actor: "B", promptId: prompt.id, target: reserve },
  2,
  "replacement",
);
assert.ok(result.ok);
const finished = (await second.snapshot()).state;
assert.equal(finished.flow?.status, "finished");
assert.equal(
  new WorldQuery(finished.battle.world).get(pet, reserve).health.hp,
  10,
);
assert.equal(finished.battle.activeFlows.length, 0);
console.log(
  "第二击完成：替补生命 10，流程修正已清理，保留攻击",
  effectiveAttack(finished.battle, attacker),
);
const stale = await first.dispatch(
  { kind: "heal", target: attacker, amount: 1 },
  3,
  "stale-worker",
);
assert.equal(stale.ok, false);
console.log("旧工作进程提交被拒绝。");
