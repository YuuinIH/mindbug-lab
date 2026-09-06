import type { Decision } from '@yuuinih/turn-kernel';
import { other } from './model.js';
import type { Command, Fact, Player, State } from './model.js';
import type { Resolution } from './resolution.js';
export function createActions(matchId: string, resolution: Resolution) {
 const { creature, finishTurn, combat, attack } = resolution;
  function decide(s: State, c: Command): Decision<State, Fact> {
    const facts: Fact[] = [];
    const reject = (): Decision<State, Fact> => ({ ok: false, reason: 'Illegal action, actor, reference or target' });
    const flow = s.flow;
    switch (flow.kind) {
      case 'action': {
        if (c.actor !== s.active) return reject();
        if (c.kind === 'play') {
          const card = s.cards.find(card => card.id === c.card.id && card.zone === 'hand' && card.controller === c.actor);
          if (c.card.matchId !== matchId || !card) return reject();
          card.zone = 'pending';
          refill(s, c.actor);
          facts.push({ kind: 'offered', cardId: card.id, player: c.actor });
          if (s.players[other(c.actor)].mindbugs > 0) s.flow = { kind: 'mindbug', cardId: card.id };
          else {
            card.zone = 'field';
            facts.push({ kind: 'entered', cardId: card.id, controller: card.controller, taken: false });
            finishTurn(s, other(c.actor), facts);
          }
        } else if (c.kind === 'attack') {
          const attacker = creature(s, c.creature, c.actor);
          if (!attacker || !attack(s, attacker, c.target, 1, facts)) return reject();
        } else return reject();
        break;
      }
      case 'mindbug': {
        if (c.kind !== 'mindbug' || c.actor !== other(s.active)) return reject();
        const card = s.cards.find(card => card.id === flow.cardId && card.zone === 'pending');
        if (!card) throw Error('Missing pending card');
        if (c.take) {
          if (s.players[c.actor].mindbugs === 0) return reject();
          s.players[c.actor].mindbugs -= 1;
          card.controller = c.actor;
        }
        card.zone = 'field';
        facts.push({ kind: 'entered', cardId: card.id, controller: card.controller, taken: c.take });
        finishTurn(s, c.take ? s.active : other(s.active), facts);
        break;
      }
      case 'block': {
        if (c.kind !== 'block' || c.actor !== other(s.active)) return reject();
        const attacker = s.cards.find(card => card.id === flow.attackerId);
        if (!attacker) throw Error('Missing attacker');
        const blocker = c.blocker === null ? undefined : creature(s, c.blocker, c.actor);
        if (c.blocker !== null && !blocker) return reject();
        combat(s, attacker, blocker, flow.attackNumber, facts);
        break;
      }
      case 'frenzy': {
        if (c.kind !== 'frenzy' || c.actor !== s.active) return reject();
        if (!c.again) {
          if (c.target) return reject();
          finishTurn(s, other(s.active), facts);
        } else {
          const attacker = s.cards.find(card => card.id === flow.attackerId);
          if (!attacker || !attack(s, attacker, c.target, 2, facts)) return reject();
        }
        break;
      }
      case 'finished': return reject();
      default: return unreachable(flow);
    }
    return { ok: true, state: s, facts };
  }
return decide;
}
function unreachable(value: never): never { throw Error(`Unhandled flow: ${String(value)}`); }
function refill(s: State, player: Player): void {
  let handSize = s.cards.filter(c => c.controller === player && c.zone === 'hand').length;
  for (const card of s.cards) {
    if (handSize >= 5) break;
    if (card.controller === player && card.zone === 'deck') {
      card.zone = 'hand';
      handSize += 1;
    }
  }
}

