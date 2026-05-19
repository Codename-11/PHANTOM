import test from 'node:test';
import assert from 'node:assert/strict';
import { _installerInternals } from '../routes/api.js';

const { classifyResult, elevatedCommandPreview } = _installerInternals;

test('classifyResult flags Linux "must be root" stderr as admin', () => {
  const result = classifyResult({
    exit: 1, timedOut: false, backend: 'apt',
    stderrTail: 'apt-get: must be root to install packages',
    stdoutTail: '',
  });
  assert.equal(result.kind, 'admin');
});

test('classifyResult flags sudo password prompt failure as admin', () => {
  const result = classifyResult({
    exit: 1, timedOut: false, backend: 'apt',
    stderrTail: 'sudo: a password is required',
    stdoutTail: '',
  });
  assert.equal(result.kind, 'admin');
});

test('classifyResult flags Windows "Access is denied" as admin', () => {
  const result = classifyResult({
    exit: 5, timedOut: false, backend: 'choco',
    stderrTail: '', stdoutTail: 'Access is denied. Re-run as administrator.',
  });
  assert.equal(result.kind, 'admin');
});

test('classifyResult flags winget elevation exit code as admin', () => {
  const result = classifyResult({
    exit: -2147023293, timedOut: false, backend: 'winget',
    stderrTail: '', stdoutTail: '',
  });
  assert.equal(result.kind, 'admin');
});

test('classifyResult flags chocolatey MSI 1603 as admin', () => {
  const result = classifyResult({
    exit: 1603, timedOut: false, backend: 'choco',
    stderrTail: '', stdoutTail: '',
  });
  assert.equal(result.kind, 'admin');
});

test('classifyResult returns "ok" for exit 0', () => {
  assert.equal(classifyResult({ exit: 0, backend: 'apt' }).kind, 'ok');
});

test('classifyResult returns "timeout" for timedOut', () => {
  assert.equal(classifyResult({ exit: 124, timedOut: true, backend: 'apt' }).kind, 'timeout');
});

test('classifyResult returns "failed" for unrelated non-zero exit', () => {
  const result = classifyResult({
    exit: 100, timedOut: false, backend: 'apt',
    stderrTail: 'Could not resolve dependency: foo',
    stdoutTail: '',
  });
  assert.equal(result.kind, 'failed');
});

test('classifyResult returns "skipped" for skipped steps', () => {
  assert.equal(classifyResult({ skipped: true, reason: 'no backend' }).kind, 'skipped');
});

test('elevatedCommandPreview produces a PowerShell Start-Process line on Windows', () => {
  const cmd = elevatedCommandPreview(
    { command: 'winget', args: ['install', '--id', 'Insecure.Nmap', '--silent'] },
    'win32',
  );
  assert.match(cmd, /Start-Process -Verb RunAs winget -ArgumentList/);
  assert.match(cmd, /Insecure\.Nmap/);
});

test('elevatedCommandPreview is already-sudo-aware on Linux', () => {
  const cmd = elevatedCommandPreview(
    { command: 'sudo', args: ['apt-get', 'install', '-y', 'nmap'] },
    'linux',
  );
  // No double-sudo.
  assert.match(cmd, /^sudo apt-get install -y nmap$/);
});

test('elevatedCommandPreview prepends sudo for non-sudo POSIX commands', () => {
  const cmd = elevatedCommandPreview(
    { command: 'brew', args: ['install', 'nmap'] },
    'darwin',
  );
  assert.match(cmd, /^sudo brew install nmap$/);
});
