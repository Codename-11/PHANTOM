import { test, describe, before, after } from 'node:test';
import assert from 'node:assert';
import config, { updateConfig, loadPersistedSettings } from './config.js';
import { existsSync, rmSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { spawnSync } from 'child_process';

describe('Config', () => {
  test('should load default configuration', () => {
    assert.strictEqual(typeof config.port, 'number');
    assert.strictEqual(typeof config.api.baseUrl, 'string');
    assert.strictEqual(typeof config.workspace, 'string');
    assert.strictEqual(typeof config.db.path, 'string');
  });

  test('updateConfig should update values', () => {
    const originalUrl = config.api.baseUrl;
    updateConfig({ baseUrl: 'https://test.api/v1' });
    assert.strictEqual(config.api.baseUrl, 'https://test.api/v1');
    updateConfig({ baseUrl: originalUrl }); // revert
  });

  test('loadPersistedSettings should apply settings and create workspace', () => {
    const mockGetSetting = (key) => {
      if (key === 'api_base_url') return 'https://mock.api/v1';
      if (key === 'workspace') return join(config.root, 'test_workspace_dir');
      return null;
    };

    loadPersistedSettings(mockGetSetting);

    assert.strictEqual(config.api.baseUrl, 'https://mock.api/v1');
    assert.strictEqual(config.workspace, join(config.root, 'test_workspace_dir'));
    assert.ok(existsSync(config.workspace), 'Workspace directory should be created');

    // cleanup
    rmSync(config.workspace, { recursive: true, force: true });
  });

  test('PHANTOM_DB_PATH env var overrides default db.path', () => {
    // config.js resolves db.path at import time, so we have to fork a child
    // Node process with PHANTOM_DB_PATH set to verify the override path
    // wins over the default repo-root phantom.db. This is the path the
    // Docker container takes (Dockerfile sets PHANTOM_DB_PATH=/app/data/phantom.db).
    const here = dirname(fileURLToPath(import.meta.url));
    // Use a file:// URL for the dynamic import so Windows absolute paths
    // (`C:\...`) are accepted by the ESM loader. Bare absolute paths trip
    // ERR_UNSUPPORTED_ESM_URL_SCHEME under Node 20+.
    const configUrl = pathToFileURL(join(here, 'config.js')).href;
    const probe = `import('${configUrl}').then(m => { console.log(m.default.db.path); });`;

    const overridden = spawnSync(process.execPath, ['--input-type=module', '-e', probe], {
      env: { ...process.env, PHANTOM_DB_PATH: '/app/data/phantom.db' },
      encoding: 'utf8',
    });
    assert.strictEqual(overridden.status, 0, `child exited non-zero: ${overridden.stderr}`);
    assert.strictEqual(overridden.stdout.trim(), '/app/data/phantom.db');

    // Sanity: unset PHANTOM_DB_PATH and confirm we fall back to the repo-root
    // default (i.e. dev-on-Windows behavior is preserved).
    const cleanEnv = { ...process.env };
    delete cleanEnv.PHANTOM_DB_PATH;
    const defaulted = spawnSync(process.execPath, ['--input-type=module', '-e', probe], {
      env: cleanEnv,
      encoding: 'utf8',
    });
    assert.strictEqual(defaulted.status, 0, `child exited non-zero: ${defaulted.stderr}`);
    const fallback = defaulted.stdout.trim();
    assert.ok(fallback.endsWith('phantom.db'), `expected default to end with phantom.db, got: ${fallback}`);
    assert.ok(!fallback.startsWith('/app/data/'), `expected default not to be the container path, got: ${fallback}`);
  });
});
