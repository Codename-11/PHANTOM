import test from 'node:test';
import assert from 'node:assert/strict';
import { initDB, closeDB, createConversation, createRun, setSetting } from '../memory/store.js';
import { getOnboardingStatus, markOnboardingComplete, resetOnboarding } from './onboarding.js';
import { createScope as createScopeViaStore } from '../scope/scope-store.js';

function freshDb() {
  closeDB();
  initDB(':memory:');
}

test('fresh DB reports first-run = true', () => {
  freshDb();
  const status = getOnboardingStatus();
  assert.equal(status.firstRun, true);
  assert.equal(status.completed, false);
  assert.equal(status.emptyState, true);
  assert.equal(status.signals.conversations, 0);
  assert.equal(status.signals.scopes, 0);
  assert.equal(status.signals.runs, 0);
  assert.equal(status.signals.apiKey, false);
});

test('marking onboarding complete is sticky even when DB stays empty', () => {
  freshDb();
  markOnboardingComplete(true);
  const status = getOnboardingStatus();
  assert.equal(status.completed, true);
  assert.equal(status.firstRun, false);
});

test('any conversation flips emptyState off', () => {
  freshDb();
  createConversation('Test');
  const status = getOnboardingStatus();
  assert.equal(status.signals.conversations, 1);
  assert.equal(status.emptyState, false);
  assert.equal(status.firstRun, false);
});

test('scope presence flips firstRun off and surfaces the count', () => {
  freshDb();
  createScopeViaStore({ name: 'Lab', targets: { hosts: ['10.0.0.1'] }, allowedActions: ['recon'] });
  const status = getOnboardingStatus();
  assert.equal(status.signals.scopes, 1);
  assert.equal(status.firstRun, false);
});

test('runs flip emptyState off', () => {
  freshDb();
  const conv = createConversation('R');
  createRun({ conversationId: conv.id, title: 'A', goal: 'X' });
  const status = getOnboardingStatus();
  assert.ok(status.signals.runs >= 1);
  assert.equal(status.emptyState, false);
});

test('apiKey signal mirrors stored setting', () => {
  freshDb();
  setSetting('api_key', 'sk-test');
  const status = getOnboardingStatus();
  assert.equal(status.signals.apiKey, true);
});

test('resetOnboarding clears the completion flag', () => {
  freshDb();
  markOnboardingComplete(true);
  let status = getOnboardingStatus();
  assert.equal(status.completed, true);
  resetOnboarding();
  status = getOnboardingStatus();
  assert.equal(status.completed, false);
  assert.equal(status.firstRun, true, 'first-run returns once flag is cleared');
});
