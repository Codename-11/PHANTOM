import { describe, test } from 'node:test';
import assert from 'node:assert';
import { getToolpacks, getToolpack, checkToolpackAvailability, buildToolpackPrompt } from './toolpack-registry.js';

describe('security toolpack registry', () => {
  test('ships curated governed security toolpacks with policy metadata', () => {
    const packs = getToolpacks();
    const ids = packs.map(pack => pack.id);
    assert.deepStrictEqual(ids, ['passive-osint', 'web-recon', 'network-discovery', 'web-vuln-assessment', 'offline-password-audit', 'credentialed-service-audit', 'reporting']);

    const password = getToolpack('offline-password-audit');
    assert.ok(password.tools.some(tool => tool.name === 'hashcat'));
    assert.ok(password.blockedByDefault.includes('online-bruteforce'));
    assert.ok(password.allowedActions.includes('offline-password-audit'));
    assert.ok(password.levels.basic.tools.includes('john'));
    assert.ok(password.levels.kali.wordlists.includes('/usr/share/wordlists/rockyou.txt'));
    assert.ok(!JSON.stringify(password).match(/password\s*[:=]\s*[^,}]+/i));

    const auth = getToolpack('credentialed-service-audit');
    assert.ok(auth.allowedActions.includes('online-bruteforce'));
    assert.ok(auth.levels.basic.tools.includes('smbclient'));
    assert.ok(auth.levels.kali.tools.includes('hydra'));
    assert.ok(auth.blockedByDefault.includes('credential-stuffing'));
  });

  test('exposes Basic and Kali capability levels without enabling online brute force by default', () => {
    const password = getToolpack('offline-password-audit');
    assert.strictEqual(password.defaultLevel, 'basic');
    assert.deepStrictEqual(Object.keys(password.levels), ['basic', 'kali']);
    assert.ok(password.levels.basic.description.match(/built-in/i));
    assert.ok(password.levels.kali.tools.includes('hashcat'));
    assert.ok(!password.allowedActions.includes('online-bruteforce'));
  });

  test('returns availability checks without executing installation commands', () => {
    const result = checkToolpackAvailability('network-discovery', {
      commandExists: (command) => command === 'nmap',
    });
    assert.strictEqual(result.id, 'network-discovery');
    assert.ok(result.tools.some(tool => tool.name === 'nmap' && tool.available));
    assert.ok(result.tools.some(tool => tool.name === 'naabu' && !tool.available && tool.installHint));
  });

  test('builds prompt fragments for selected toolpacks', () => {
    const prompt = buildToolpackPrompt(['passive-osint', 'offline-password-audit']);
    assert.match(prompt, /Passive OSINT/);
    assert.match(prompt, /Offline Password Audit/);
    assert.match(prompt, /Capability levels/i);
    assert.match(prompt, /Kali/i);
    assert.match(prompt, /Never perform online brute force/i);
    assert.doesNotMatch(prompt, /undefined/);
  });
});
