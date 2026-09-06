import { defineNumericValue, Evaluation, WorldQuery, type Ref } from '@yuuinih/turn-kernel';
import { pet, type Battle } from './model.js';
export const attack = defineNumericValue<Battle, 'pet'>('attack', '1', 'pet', (q, ref) =>
  q.observe(`object:${ref.id}:attack`, state => new WorldQuery(state.world).get(pet, ref).attack), n => Math.max(0, Math.floor(n)));
export const cost = defineNumericValue<Battle, 'pet'>('cost', '1', 'pet', (q, ref) =>
  q.observe(`object:${ref.id}:cost`, state => new WorldQuery(state.world).get(pet, ref).cost), n => Math.max(0, Math.floor(n)));
export const valueDefinitions = [attack, cost];
export function evaluate(battle: Battle) { return new Evaluation(battle, valueDefinitions, battle.modifiers); }
export function effectiveAttack(battle: Battle, ref: Ref<'pet'>): number { return evaluate(battle).read(attack, ref); }
export function effectiveCost(battle: Battle, ref: Ref<'pet'>): number { return evaluate(battle).read(cost, ref); }
