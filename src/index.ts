import { createHash } from 'node:crypto';
import { z } from 'zod';
import { createSession, restoreSession, type Decision, type GameDefinition } from '@yuuinih/turn-kernel';
import { commandSchema, definitionsSchema, other, stateSchema } from './model.js';
import type { Card, Command, CreatureRef, Definition, Fact, Player, State } from './model.js';
export type { CardRef, CreatureRef, Command, Definition, Fact, Player, State } from './model.js';

function gameFor(matchId: string, input: unknown): GameDefinition<State, Command, Fact> {
  z.string().min(1).max(100).parse(matchId);
  const definitions = definitionsSchema.parse(input);
  const contentHash = createHash('sha256').update(JSON.stringify(definitions)).digest('hex');
  const byId = new Map(definitions.map(d => [d.id, d]));
  function definition(card: Card): Definition {
    const found = byId.get(card.definition);
    if (!found) throw Error('Missing definition');
    return found;
  }
  function has(card: Card, keyword: Definition['keywords'][number]): boolean {
    return definition(card).keywords.includes(keyword);
  }
  function canAct(state: State, actor: Player): boolean {
    return state.cards.some(c => c.controller === actor && (c.zone === 'hand' || c.zone === 'field'));
  }
  function parseState(input: unknown): State {
    const s = stateSchema.parse(input);
    if (s.matchId !== matchId) throw Error('Wrong match');
    if (new Set(s.cards.map(c => c.id)).size !== s.cards.length) throw Error('Duplicate instance ID');
    for (const c of s.cards) {
      definition(c);
      if (c.exhausted && (!has(c, 'tough') || !['field', 'discard'].includes(c.zone))) throw Error('Invalid exhaustion');
    }
    for (const actor of ['A', 'B'] satisfies Player[]) {
      const handSize = s.cards.filter(c => c.controller === actor && c.zone === 'hand').length;
      // The supported subset has no additional draw/card-gain abilities.
      if (handSize > 5) throw Error('Hand exceeds subset limit');
      if (handSize < 5 &&
        s.cards.some(c => c.controller === actor && c.zone === 'deck')) throw Error('Hand must refill before waiting');
    }
    const pending = s.cards.filter(c => c.zone === 'pending');
    const f = s.flow;
    if (f.kind === 'mindbug') {
      if (pending.length !== 1 || pending[0]?.id !== f.cardId || pending[0].controller !== s.active ||
        s.players[other(s.active)].mindbugs === 0) throw Error('Invalid takeover window');
    } else if (pending.length) throw Error('Unexpected pending card');
    if (f.kind === 'block' || f.kind === 'frenzy') {
      const attacker = s.cards.find(c => c.id === f.attackerId);
      if (!attacker || attacker.zone !== 'field' || attacker.controller !== s.active) throw Error('Invalid attacker');
      if ((f.kind === 'frenzy' || f.attackNumber === 2) && !has(attacker, 'frenzy')) throw Error('Invalid extra attack');
    }
    if (f.kind === 'finished') {
      const loser = other(f.winner);
      if (s.players[f.winner].life <= 0) throw Error('Winner must be alive');
      if (f.reason === 'life' && s.players[loser].life !== 0) throw Error('Invalid life victory');
      if (f.reason === 'no-actions' && (canAct(s, loser) || s.active !== loser || s.players[loser].life <= 0)) {
        throw Error('Invalid no-action victory');
      }
    } else {
      if (s.players.A.life <= 0 || s.players.B.life <= 0) throw Error('Zero life requires game end');
      if (f.kind === 'action' && !canAct(s, s.active)) throw Error('No actions requires game end');
    }
    return s;
  }
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
  return { ruleset: `mindbug-lab/1/${contentHash}`, parseState, parseCommand: value => commandSchema.parse(value), decide };
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

export function createMatch(matchId: string, definitions: unknown, inputDecks: unknown) {
  const game = gameFor(matchId, definitions);
  const deck = z.array(z.string().min(1)).length(10);
  const decks = z.strictObject({ A: deck, B: deck }).parse(inputDecks);
  const cards: Card[] = [];
  for (const player of ['A', 'B'] satisfies Player[]) {
    decks[player].forEach((definition, index) => cards.push({
      id: `${player}-${index}`, definition, controller: player, zone: index < 5 ? 'hand' : 'deck', exhausted: false,
    }));
  }
  const state: State = {
    matchId, active: 'A', players: { A: { life: 3, mindbugs: 2 }, B: { life: 3, mindbugs: 2 } },
    cards, flow: { kind: 'action' },
  };
  return createSession(game, matchId, state);
}

export function restoreMatch(matchId: string, definitions: unknown, input: unknown) {
  const session = restoreSession(gameFor(matchId, definitions), input);
  if (session.snapshot().sessionId !== matchId) throw Error('Snapshot session mismatch');
  return session;
}
