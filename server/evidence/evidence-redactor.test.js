import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { redact, findLeaks, _internals } from './evidence-redactor.js';

describe('evidence-redactor', () => {
  test('mask: short tokens collapse to ••••, long keep last 4', () => {
    assert.strictEqual(_internals.mask(''), '••••');
    assert.strictEqual(_internals.mask('abc'), '••••');
    assert.strictEqual(_internals.mask('sk-foobarbaz1234'), '••••1234');
  });

  test('redacts OpenAI-style keys in plain strings', () => {
    const r = redact('the api key is sk-AbCdEfGh1234567890ZZ for prod');
    assert.match(r, /••••90ZZ/);
    assert.doesNotMatch(r, /sk-AbCdEfGh1234567890ZZ/);
  });

  test('redacts Anthropic-style keys', () => {
    const r = redact('sk-ant-abc12345xyz67890DEF');
    assert.match(r, /••••/);
    assert.doesNotMatch(r, /sk-ant-abc12345xyz67890DEF/);
  });

  test('redacts Bearer tokens but preserves the keyword', () => {
    const r = redact('Authorization: Bearer eyJabcdefghijklmnopqrstuvwxyz1234');
    assert.match(r, /Bearer ••••/);
    assert.doesNotMatch(r, /eyJabcdefghijklmnopqrstuvwxyz1234/);
  });

  test('redacts AWS access key id', () => {
    const r = redact('AKIA1234567890ABCDEF is the access key');
    assert.match(r, /••••CDEF/);
    assert.doesNotMatch(r, /AKIA1234567890ABCDEF/);
  });

  test('redacts JWT-shaped strings', () => {
    const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NSJ9.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c';
    const r = redact(jwt);
    assert.notStrictEqual(r, jwt);
    assert.match(r, /••••/);
  });

  test('redacts API_KEY=VALUE env-style', () => {
    const r = redact('API_KEY=sk-secretvalue1234567890 SECRET=otherthing12345');
    assert.match(r, /API_KEY=••••/);
    assert.match(r, /SECRET=••••/);
    assert.doesNotMatch(r, /sk-secretvalue1234567890/);
  });

  test('redacts long hex blobs', () => {
    const hex = 'abcdef0123456789abcdef0123456789abcdef0123456789';
    const r = redact(`hash=${hex}`);
    assert.match(r, /••••/);
    assert.doesNotMatch(r, new RegExp(hex));
  });

  test('redacts object values whose keys are secret-named', () => {
    const obj = { apiKey: 'sk-secret1234', user: 'alice', sudo_password: 'hunter2', authorization: 'Bearer raw' };
    const r = redact(obj);
    assert.strictEqual(r.user, 'alice');
    assert.match(r.apiKey, /^••••/);
    assert.match(r.sudo_password, /^••••/);
    assert.match(r.authorization, /^••••|Bearer ••••/);
    assert.doesNotMatch(JSON.stringify(r), /hunter2/);
    assert.doesNotMatch(JSON.stringify(r), /sk-secret1234/);
  });

  test('walks nested arrays + objects', () => {
    const input = {
      events: [
        { id: 1, output: 'fine' },
        { id: 2, output: 'Authorization: Bearer eyJverylongtoken1234567890' },
      ],
      meta: { creds: { apiKey: 'sk-deeplynested12345' } },
    };
    const r = redact(input);
    assert.strictEqual(r.events[0].output, 'fine');
    assert.match(r.events[1].output, /••••/);
    assert.match(r.meta.creds.apiKey, /^••••/);
  });

  test('findLeaks: empty when input is fully redacted', () => {
    const original = { apiKey: 'sk-mysecretkey1234567890', text: 'plain' };
    const redacted = redact(original);
    assert.deepEqual(findLeaks(redacted), []);
  });

  test('findLeaks: detects raw secrets in inputs that bypass redact', () => {
    const tainted = { notes: 'leftover sk-myrawkey1234567890 in the synthesis output' };
    const leaks = findLeaks(tainted);
    assert.ok(leaks.length >= 1);
    assert.ok(leaks.some((l) => l.kind === 'openai_key'));
  });

  test('redact preserves primitives', () => {
    assert.strictEqual(redact(null), null);
    assert.strictEqual(redact(undefined), undefined);
    assert.strictEqual(redact(42), 42);
    assert.strictEqual(redact(true), true);
  });

  test('fuzz: 100 inputs with random secret-bearing strings produce no leaks', () => {
    const samples = [
      'sk-foobar1234567890BARBAZ',
      'AKIAABCDEFGH12345678',
      'Bearer abcdef1234567890ghijkl',
      'API_KEY=zzz1234567890abc',
      'eyJhbGc.eyJzdWI.SflKxwR',
      '8d6b9fe5c97c8d6b9fe5c97c8d6b9fe5c97c8d6b9fe5c97c', // hex
    ];
    for (let i = 0; i < 100; i++) {
      const obj = {
        text: samples[i % samples.length] + ' tail',
        nested: { apiKey: samples[(i + 1) % samples.length] },
      };
      const r = redact(obj);
      const leaks = findLeaks(r);
      assert.deepEqual(leaks, [], `fuzz ${i} left leaks: ${JSON.stringify(leaks)}`);
    }
  });
});
