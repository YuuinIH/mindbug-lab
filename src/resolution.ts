import { other } from './model.js';
import type { Card, CreatureRef, Fact, Player, State } from './model.js';
import type { Rules } from './rules.js';
export function createResolution(matchId: string, rules: Rules) {
 const { definition, has, canAct } = rules;
  function creature(s: State, ref: CreatureRef, controller: Player): Card | undefined {
    if (ref.matchId !== matchId) return undefined;
    return s.cards.find(c => c.id === ref.id && c.zone === 'field' && c.controller === controller);
  }
  function finishTurn(s: State, next: Player, facts: Fact[]): void {
    s.active = next;
    if (!canAct(s, next)) {
      s.flow = { kind: 'finished', winner: other(next), reason: 'no-actions' };
      facts.push({ kind: 'finished', winner: other(next) });
    } else {
      s.flow = { kind: 'action' };
      facts.push({ kind: 'turn', player: next });
    }
  }
  function defeat(c: Card, facts: Fact[]): void {
    if (has(c, 'tough') && !c.exhausted) {
      c.exhausted = true;
      facts.push({ kind: 'exhausted', cardId: c.id });
    } else {
      c.zone = 'discard';
      facts.push({ kind: 'defeated', cardId: c.id });
    }
  }
  function combat(s: State, attacker: Card, blocker: Card | undefined, number: 1 | 2, facts: Fact[]): void {
    if (blocker) {
      const attackPower = definition(attacker).power;
      const blockPower = definition(blocker).power;
      // Determine both outcomes from the same pre-combat state.
      if (attackPower <= blockPower) defeat(attacker, facts);
      if (blockPower <= attackPower) defeat(blocker, facts);
    } else {
      const defender = other(s.active);
      s.players[defender].life -= 1;
      facts.push({ kind: 'life-lost', player: defender, life: s.players[defender].life });
      if (s.players[defender].life === 0) {
        s.flow = { kind: 'finished', winner: s.active, reason: 'life' };
        facts.push({ kind: 'finished', winner: s.active });
        return;
      }
    }
    if (number === 1 && attacker.zone === 'field' && has(attacker, 'frenzy')) {
      s.flow = { kind: 'frenzy', attackerId: attacker.id };
    } else finishTurn(s, other(s.active), facts);
  }
  function attack(s: State, attacker: Card, target: CreatureRef | undefined, number: 1 | 2, facts: Fact[]): boolean {
    if (target) {
      const blocker = creature(s, target, other(s.active));
      if (!has(attacker, 'hunter') || !blocker) return false;
      facts.push({ kind: 'attacked', cardId: attacker.id, number });
      combat(s, attacker, blocker, number, facts);
    } else {
      facts.push({ kind: 'attacked', cardId: attacker.id, number });
      s.flow = { kind: 'block', attackerId: attacker.id, attackNumber: number };
    }
    return true;
  }
return { creature, finishTurn, combat, attack };
}
export type Resolution = ReturnType<typeof createResolution>;
