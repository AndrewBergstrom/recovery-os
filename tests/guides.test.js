import { test } from 'node:test';
import assert from 'node:assert/strict';
import { exerciseGuide, GUIDED_EXERCISE_IDS } from '../js/exercise-guides.js';
import { orders } from '../js/seed.js';

test('every seeded exercise has a visual guide with plain-language steps and no invented parameters', () => {
  const exercises = orders.filter((o) => o.type === 'exercise');
  assert.ok(exercises.length >= 4);
  for (const x of exercises) {
    const g = exerciseGuide(x.id);
    assert.ok(g, `guide missing for ${x.id}`);
    assert.ok(g.steps.length >= 3 && g.steps.length <= 5, `${x.id} has ${g.steps.length} steps`);
    assert.ok(g.title.length > 20);
    // Steps never prescribe counts — those come from the order/PT.
    for (const step of g.steps) assert.ok(!/\b\d+\s*(reps|sets|seconds|minutes)\b/i.test(step), `${x.id}: step prescribes a number: ${step}`);
  }
  assert.deepEqual([...GUIDED_EXERCISE_IDS].sort(), exercises.map((x) => x.id).sort());
});
