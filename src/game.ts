import { defineOperation, FlowRuntime, OperationRuntime, registration, parse, type FlowDefinition, type GameDefinition, type Operation, type OperationRequest } from '@yuuinih/turn-kernel';
import { commandSchema, type Command, type Fact, type State } from './model.js';
import { createRules } from './rules.js';
import { createResolution } from './resolution.js';
import { createActions } from './actions.js';
import { createStateParser } from './state-validation.js';
import { registerContent } from './registration.js';

export function gameFor(matchId: string, input: unknown): GameDefinition<State, Command, Fact> {
  parse.text(matchId);
  const { cards, builder } = registerContent(input);
  const rules = createRules(cards.value);
  const parseState = createStateParser(matchId, rules);
  const actions = createActions(matchId, createResolution(matchId, rules));
  const registrations = (['play', 'mindbug', 'attack', 'block', 'frenzy'] satisfies Command['kind'][]).map(kind => {
    const operation = defineOperation<State, Command, Fact>({ id: kind, version: '1',
      parse: value => { const c = commandSchema.parse(value); if (c.kind !== kind) throw Error('Wrong operation command'); return c; },
      execute: (state, command) => {
        const result = actions(state, command);
        if (!result.ok) throw Error(result.reason);
        return result;
      },
      authorize: (before, after) => authorizeTransition(kind, before, after),
    });
    const token = registration('operation', kind, '1', operation.operation, ['content:cards']);
    builder.add(token); return token;
  });
  // Mindbug's state checkpoints retain its game-specific flow; each input executes a
  // bounded operation through the same resumable flow protocol used by pet-duel.
  const commandFlow: FlowDefinition<State> = { id: 'command', version: '1', steps: { run: {
    parseLocals: value => commandSchema.parse(value),
    advance: (_state, frame) => {
      const command = commandSchema.parse(frame.locals);
      const request: OperationRequest = { operation: command.kind, version: '1', input: command };
      return { kind: 'done', result: null, operations: [request] };
    },
  } } };
  const flowToken = registration('flow', 'command', '1', commandFlow, registrations.map(t => `operation:${t.id}`));
  builder.add(flowToken);
  const assembled = builder.build('mindbug-lab', '2');
  const operations: Operation<State, Fact>[] = registrations.map(t => assembled.resolve(t));
  const runtime = new OperationRuntime(parseState, operations);
  const flow = new FlowRuntime([assembled.resolve(flowToken)], runtime);
  return { ruleset: assembled.id, parseState, parseCommand: value => commandSchema.parse(value),
    decide: (state, command) => {
      const result = flow.run({ state, flow: flow.start({ type: 'command', version: '1', step: 'run', locals: command }) });
      if (result.flow.status === 'fault') return { ok: false, reason: result.flow.error ?? 'Rule failure' };
      return { ok: true, state: result.state, facts: result.facts };
    },
  };
}
function authorizeTransition(kind: Command['kind'], before: State, after: State): void {
  if (before.matchId !== after.matchId || before.cards.length !== after.cards.length) throw Error('Identity write denied');
  for (let i = 0; i < before.cards.length; i += 1) {
    const a = before.cards[i]; const b = after.cards[i];
    if (!a || !b || a.id !== b.id || a.definition !== b.definition) throw Error('Card identity write denied');
    if (kind !== 'mindbug' && a.controller !== b.controller) throw Error('Control write denied');
    if (kind !== 'attack' && kind !== 'block' && kind !== 'frenzy' && a.exhausted !== b.exhausted) throw Error('Exhaustion write denied');
  }
  for (const player of ['A', 'B'] satisfies Array<'A' | 'B'>) {
    const a = before.players[player]; const b = after.players[player];
    if ((kind !== 'attack' && kind !== 'block' && kind !== 'frenzy') && a.life !== b.life) throw Error('Life write denied');
    if (b.life > a.life || a.life - b.life > 1) throw Error('Invalid life delta');
    if (kind !== 'mindbug' && a.mindbugs !== b.mindbugs) throw Error('Mindbug write denied');
  }
}
