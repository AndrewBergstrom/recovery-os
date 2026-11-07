// exercises.js — exercise ORDER helpers and the clearance gate.
// An exercise is never presented as a prescribed, due task unless cleared === true
// with cleared_by / cleared_on / instructions_version recorded.

import { activeOrders, orderKey } from './medications.js';
import { currentEvents } from './events.js';

export function exerciseOrders(orders) {
  return activeOrders(orders, 'exercise');
}

export function isCleared(exercise) {
  return exercise?.cleared === true && !!exercise.cleared_by && !!exercise.cleared_on;
}

/** Only cleared exercises may ever be shown as due. */
export function exerciseMayBeDue(exercise) {
  return isCleared(exercise);
}

export function partitionExercises(orders) {
  const all = exerciseOrders(orders);
  return {
    cleared: all.filter(isCleared),
    pending: all.filter((e) => !isCleared(e)),
  };
}

export const SYMPTOM_RESPONSES = [
  { id: 'comfortable', label: 'Comfortable' },
  { id: 'mild_discomfort', label: 'Mild discomfort' },
  { id: 'stopped_symptoms', label: 'Stopped due to symptoms' },
];

export const SESSION_OUTCOMES = [
  { id: 'completed', label: 'Completed', completed: true },
  { id: 'stopped_early', label: 'Stopped early', completed: false },
  { id: 'not_today', label: 'Not today', completed: false },
];

/** Record clinician clearance as a NEW order version; the previous version is kept. */
export function markCleared(exercise, { cleared_by, cleared_by_name, cleared_on, instructions_version, parameters, todayStr }) {
  if (!cleared_by) throw new Error('Record who cleared this exercise.');
  if (!cleared_on) throw new Error('Record the clearance date.');
  if (!instructions_version) throw new Error('Record the instructions version or source.');
  const newVersion = {
    ...exercise,
    version: (exercise.version || 1) + 1,
    cleared: true,
    cleared_by: cleared_by_name ? `${cleared_by} (${cleared_by_name})` : cleared_by,
    cleared_on,
    instructions_version,
    parameters: parameters || exercise.parameters,
    status: 'cleared',
    valid_from: todayStr,
    valid_to: null,
  };
  newVersion.key = orderKey(newVersion);
  return { newVersion, previous: { ...exercise, valid_to: todayStr } };
}

export function exerciseSessions(events, exerciseId = null) {
  return currentEvents(events).filter((e) => e.event_type === 'exercise' && (!exerciseId || e.exercise_id === exerciseId));
}
