import assert from "node:assert/strict";
import { WorldQuery } from "@yuuinih/turn-kernel";
import { createPetDuel, restorePetDuel } from "./game.js";
import { pet } from "./model.js";
import { parsePendingStrike, strikeSettlement } from "./strike-definition.js";
const game = createPetDuel("strike-demo");
const source = pet.ref("strike-demo", "attacker"),
  target = pet.ref("strike-demo", "reserve");
assert.ok(game.dispatch({ kind: "strike", source, target }, 0).ok);
const saved = game.snapshot(),
  frame = saved.state.flow?.stack.at(-1),
  prompt = saved.state.flow?.prompt;
assert.ok(frame);
assert.ok(prompt);
const pending = parsePendingStrike(frame.data);
console.log(
  "已固定攻击与随机结果：",
  pending.input.attack,
  "+",
  pending.input.rolled,
  "=",
  strikeSettlement.read(pending, "sampledDamage"),
);
assert.equal(
  new WorldQuery(saved.state.battle.world).get(pet, target).health.hp,
  30,
);
console.log("等待防守方选择；目标尚未扣血，结算数据已经归档。");
const restored = restorePetDuel(
  "strike-demo",
  JSON.parse(JSON.stringify(saved)),
);
assert.ok(
  restored.dispatch(
    { kind: "respond", promptId: prompt.id, actor: "B", guard: true },
    1,
  ).ok,
);
const complete = strikeSettlement.parse(restored.view().flow?.result);
assert.equal(restored.view().battle.rng, saved.state.battle.rng);
console.log(
  "恢复后格挡：本次伤害",
  strikeSettlement.read(complete, "incomingDamage"),
  "；目标生命",
  new WorldQuery(restored.view().battle.world).get(pet, target).health.hp,
);
console.log("结算已完成，随机状态未再次推进；格挡未成为组件属性修正。");
