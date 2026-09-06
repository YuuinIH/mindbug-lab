import { stateSchema, other } from './model.js';
import type { State, Player } from './model.js';
import type { Rules } from './rules.js';
import { validateControlRelations } from './registration.js';
export function createStateParser(matchId: string, rules: Rules) {
 const { definition, has, canAct } = rules;
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
    validateControlRelations(s);
    return s;
  }
return parseState;
}
