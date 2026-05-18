import { describe, test } from 'node:test';
import assert from 'node:assert';
import { extractTargets, classifyRisk, evaluateToolAction } from './policy.js';

const activeScope = {
  id: 'scope-1',
  name: 'Example scope',
  targets: {
    hosts: ['127.0.0.1', 'api.example.com'],
    domains: ['example.com'],
    cidrs: ['192.168.1.0/24'],
    urls: ['https://example.com/app'],
  },
  allowed_actions: ['read/local', 'recon', 'network-scan'],
  blocked_actions: [],
  expires_at: null,
};

describe('scope policy evaluator', () => {
  test('extracts URLs, IPs, domains, and host:port observations', () => {
    const targets = extractTargets({ command: 'nmap -sV 192.168.1.10 && curl https://api.example.com:8443/login && nc -vz 10.0.0.5 22' });
    assert.ok(targets.includes('https://api.example.com:8443/login'));
    assert.ok(targets.includes('api.example.com'));
    assert.ok(targets.includes('192.168.1.10'));
    assert.ok(targets.includes('10.0.0.5'));
    assert.ok(targets.includes('10.0.0.5:22'));
  });

  test('classifies common tool actions conservatively', () => {
    assert.strictEqual(classifyRisk('read_file', { path: '/tmp/a' }), 'read/local');
    assert.strictEqual(classifyRisk('execute_command', { command: 'nmap -sV 192.168.1.10' }), 'network-scan');
    assert.strictEqual(classifyRisk('execute_command', { command: 'rm -rf /tmp/phantom-test' }), 'destructive');
    assert.strictEqual(classifyRisk('execute_command', { command: 'sqlmap -u https://example.com' }), 'exploit');
    assert.strictEqual(classifyRisk('execute_command', { command: 'john --wordlist=/usr/share/wordlists/rockyou.txt hashes.txt' }), 'offline-password-audit');
    assert.strictEqual(classifyRisk('execute_command', { command: 'hydra -l bailey -P wordlist.txt smb://192.168.1.10:445/' }), 'online-bruteforce');
    assert.strictEqual(classifyRisk('web_request', { url: 'https://example.com' }), 'recon');
  });

  test('allows in-scope network actions', () => {
    const decision = evaluateToolAction({ toolName: 'execute_command', args: { command: 'nmap -sV 192.168.1.25' }, scope: activeScope });
    assert.strictEqual(decision.allowed, true);
    assert.strictEqual(decision.risk, 'network-scan');
    assert.ok(decision.targets.includes('192.168.1.25'));
  });

  test('does not treat local wordlist filenames as out-of-scope remote targets', () => {
    const scope = {
      ...activeScope,
      targets: { cidrs: ['172.16.24.0/24'] },
      allowed_actions: ['online-bruteforce'],
    };
    const decision = evaluateToolAction({
      toolName: 'execute_command',
      args: { command: 'hydra -l bailey -P wordlist.txt smb://172.16.24.12:445/' },
      scope,
    });
    assert.strictEqual(decision.risk, 'online-bruteforce');
    assert.strictEqual(decision.allowed, true);
    assert.ok(decision.targets.includes('172.16.24.12'));
    assert.ok(decision.targets.includes('172.16.24.12:445'));
    assert.ok(!decision.targets.includes('wordlist.txt'));
  });

  test('allows offline password audits with local hash and wordlist files when explicitly authorized', () => {
    const scope = {
      ...activeScope,
      targets: {},
      allowed_actions: ['offline-password-audit'],
    };
    const decision = evaluateToolAction({
      toolName: 'execute_command',
      args: { command: 'john --wordlist=/usr/share/wordlists/rockyou.txt /tmp/hashdump.txt' },
      scope,
    });
    assert.strictEqual(decision.risk, 'offline-password-audit');
    assert.strictEqual(decision.allowed, true);
    assert.deepStrictEqual(decision.targets, []);
  });

  test('keeps online brute force separate from offline password audit authorization', () => {
    const offlineOnly = {
      ...activeScope,
      targets: { cidrs: ['172.16.24.0/24'] },
      allowed_actions: ['offline-password-audit'],
    };
    const command = 'hydra -l bailey -P wordlist.txt smb://172.16.24.12:445/';
    const blocked = evaluateToolAction({ toolName: 'execute_command', args: { command }, scope: offlineOnly });
    assert.strictEqual(blocked.risk, 'online-bruteforce');
    assert.strictEqual(blocked.allowed, false);
    assert.match(blocked.reason, /not allowed/i);

    const onlineAllowed = { ...offlineOnly, allowed_actions: ['online-bruteforce'] };
    const allowed = evaluateToolAction({ toolName: 'execute_command', args: { command }, scope: onlineAllowed });
    assert.strictEqual(allowed.allowed, true);
    assert.deepStrictEqual(allowed.targets, ['172.16.24.12', '172.16.24.12:445']);
  });

  test('requires explicit new password-audit actions instead of broad credentialed allowlists', () => {
    const broadCredentialed = {
      ...activeScope,
      targets: { cidrs: ['172.16.24.0/24'] },
      allowed_actions: ['credentialed'],
    };
    const hydra = evaluateToolAction({
      toolName: 'execute_command',
      args: { command: 'hydra -l bailey -P wordlist.txt smb://172.16.24.12:445/' },
      scope: broadCredentialed,
    });
    assert.strictEqual(hydra.risk, 'online-bruteforce');
    assert.strictEqual(hydra.allowed, false);

    const john = evaluateToolAction({
      toolName: 'execute_command',
      args: { command: 'john --wordlist=/usr/share/wordlists/rockyou.txt /tmp/hashdump.txt' },
      scope: broadCredentialed,
    });
    assert.strictEqual(john.risk, 'offline-password-audit');
    assert.strictEqual(john.allowed, false);
  });

  test('blocks risky target outside selected scope', () => {
    const decision = evaluateToolAction({ toolName: 'execute_command', args: { command: 'nmap -sV 10.0.0.5' }, scope: activeScope });
    assert.strictEqual(decision.allowed, false);
    assert.match(decision.reason, /outside selected scope/i);
    assert.deepStrictEqual(decision.targets.filter(t => t === '10.0.0.5'), ['10.0.0.5']);
  });

  test('blocks expired scopes and explicit denied action classes', () => {
    const expired = { ...activeScope, expires_at: '2000-01-01T00:00:00.000Z' };
    assert.strictEqual(evaluateToolAction({ toolName: 'web_request', args: { url: 'https://example.com' }, scope: expired }).allowed, false);

    const blocked = { ...activeScope, blocked_actions: ['network-scan'] };
    const decision = evaluateToolAction({ toolName: 'execute_command', args: { command: 'nmap 192.168.1.20' }, scope: blocked });
    assert.strictEqual(decision.allowed, false);
    assert.match(decision.reason, /blocked by scope/i);
  });
});
