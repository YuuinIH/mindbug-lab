import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { createMatch, restoreMatch, type Command } from './index.js';

const definitions: unknown = JSON.parse(readFileSync(new URL('../../data/cards.json', import.meta.url), 'utf8'));
let match = createMatch('demo', definitions, {
  A: ['runner', 'scout', 'soldier', 'guard', 'soldier', 'runner', 'guard', 'scout', 'soldier', 'guard'],
  B: Array<string>(10).fill('guard'),
});
function send(command: Command): void {
  const result = match.dispatch(command, match.snapshot().revision);
  assert.equal(result.ok, true, JSON.stringify(result));
  if (result.ok) console.log(`版本 ${result.revision}`, JSON.stringify(result.facts));
}
const creature = (id: string) => ({ kind: 'creature', matchId: 'demo', id } satisfies import('./index.js').CreatureRef);
console.log('Mindbug 最小实验：所有卡名和数值均为实验数据。');
send({ kind: 'play', actor: 'A', card: { kind: 'card', matchId: 'demo', id: 'A-0' } });
const saved = JSON.stringify(match.snapshot());
match = restoreMatch('demo', definitions, JSON.parse(saved));
console.log('已从等待对手选择的位置恢复。');
send({ kind: 'mindbug', actor: 'B', take: false });
send({ kind: 'play', actor: 'B', card: { kind: 'card', matchId: 'demo', id: 'B-0' } });
send({ kind: 'mindbug', actor: 'A', take: false });
send({ kind: 'attack', actor: 'A', creature: creature('A-0') });
send({ kind: 'block', actor: 'B', blocker: creature('B-0') });
console.log('Tough 已消耗，守卫仍在场；Frenzy 等待是否再次攻击。');
send({ kind: 'frenzy', actor: 'A', again: true });
send({ kind: 'block', actor: 'B', blocker: null });
const before = match.snapshot();
const invalid = match.submit({ sessionId: 'demo', revision: before.revision,
  command: { kind: 'attack', actor: 'A', creature: creature('A-0') } });
assert.equal(invalid.ok, false);
assert.deepEqual(match.snapshot(), before);
console.log('错误行动者被拒绝，状态保持不变。');
console.log(JSON.stringify({ players: match.view().players, flow: match.view().flow, active: match.view().active }, null, 2));
