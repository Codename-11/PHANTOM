import { describe, test } from 'node:test';
import assert from 'node:assert';
import { parseTargetInput, targetsToScopeFields, classifyTargetValue } from './target-parser.js';

describe('smart scope target parser', () => {
  test('parses mixed URLs, domains, IPs, CIDRs, and host ports into editable target chips', () => {
    const parsed = parseTargetInput(`
      https://app.example.com/login
      example.com
      10.0.0.0/24
      192.168.1.10:22
      ssh://admin:secret@example.net:2222
      invalid target value
      https://app.example.com/login
    `);

    assert.ok(parsed.targets.some(t => t.type === 'url' && t.value === 'https://app.example.com/login'));
    assert.ok(parsed.targets.some(t => t.type === 'domain' && t.value === 'example.com'));
    assert.ok(parsed.targets.some(t => t.type === 'cidr' && t.value === '10.0.0.0/24' && t.visibility === 'private'));
    assert.ok(parsed.targets.some(t => t.type === 'host' && t.value === '192.168.1.10'));
    assert.ok(parsed.targets.some(t => t.type === 'host_port' && t.value === '192.168.1.10:22' && t.port === 22));
    assert.ok(parsed.targets.some(t => t.type === 'url' && t.value === 'ssh://example.net:2222'));
    assert.ok(!JSON.stringify(parsed).includes('secret'));
    assert.strictEqual(parsed.targets.filter(t => t.value === 'https://app.example.com/login').length, 1);
    assert.ok(parsed.errors.some(error => error.input.includes('invalid target value')));
  });

  test('converts parser chips into scope target fields', () => {
    const fields = targetsToScopeFields(parseTargetInput('https://api.example.com 172.16.24.250:443 172.16.24.0/24').targets);
    assert.deepStrictEqual(fields.urls, ['https://api.example.com']);
    assert.ok(fields.hosts.includes('172.16.24.250'));
    assert.deepStrictEqual(fields.hostPorts, ['172.16.24.250:443']);
    assert.deepStrictEqual(fields.cidrs, ['172.16.24.0/24']);
  });

  test('classifies public and private targets', () => {
    assert.strictEqual(classifyTargetValue('172.16.24.250').visibility, 'private');
    assert.strictEqual(classifyTargetValue('8.8.8.8').visibility, 'public');
    assert.strictEqual(classifyTargetValue('example.com').visibility, 'public');
  });
});
