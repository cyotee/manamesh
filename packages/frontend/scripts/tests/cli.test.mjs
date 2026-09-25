import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, cp, writeFile, symlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import http from 'node:http';
import { once } from 'node:events';

// Exercise the real CLI in an isolated package layout, with harmless canaries.
test('packaged CLI HTTP boundaries', { timeout: 15000 }, async t => {
  const root = await mkdtemp(join(tmpdir(), 'manamesh-cli-'));
  await mkdir(join(root, 'dist'));
  await mkdir(join(root, 'dist-private'));
  await cp(new URL('../../bin/', import.meta.url), join(root, 'bin'), { recursive: true });
  await writeFile(join(root, 'package.json'), '{"type":"module"}');
  await writeFile(join(root, 'dist/index.html'), '<div id="root">SPA</div>');
  await writeFile(join(root, 'dist/app.js'), 'export const ready = true;');
  await writeFile(join(root, 'dist-private/canary.txt'), 'OUTSIDE_CANARY');
  await symlink(join(root, 'dist-private/canary.txt'), join(root, 'dist/linked.txt'));
  const child = spawn(process.execPath, [join(root, 'bin/cli.js'), '--port', '0'], { stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  const exited = once(child, 'exit');
  t.after(async () => { child.kill(); await exited; await rm(root, { recursive: true, force: true }); });
  await new Promise((resolve, reject) => {
    child.stdout.on('data', chunk => { output += chunk; if (output.includes('listening at')) resolve(); });
    child.stderr.on('data', chunk => { output += chunk; });
    child.once('exit', code => reject(new Error(`CLI exited ${code}: ${output}`)));
  });
  const port = Number(output.match(/127\.0\.0\.1:(\d+)/)[1]);
  const request = (path, method = 'GET', accept = '*/*') => new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path, method, headers: { accept } }, res => {
      let body = ''; res.on('data', chunk => { body += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }));
    });
    req.on('error', reject); req.end();
  });
  for (const path of ['/../dist-private/canary.txt', '/%2e%2e/dist-private/canary.txt', '/linked.txt']) {
    await t.test(`rejects escaping path ${path}`, async () => {
      const response = await request(path);
      assert.equal(response.status, 403);
      assert.ok(!response.body.includes('OUTSIDE_CANARY'));
    });
  }
  await t.test('malformed encoding is a client error', async () => assert.equal((await request('/%ZZ')).status, 400));
  await t.test('missing assets are not successful HTML responses', async () => assert.equal((await request('/missing.js')).status, 404));
  await t.test('HTML navigation receives the SPA', async () => assert.match((await request('/table/123', 'GET', 'text/html')).body, /SPA/));
  await t.test('root and scripts retain content types', async () => {
    assert.equal((await request('/')).status, 200);
    assert.match((await request('/app.js')).headers['content-type'], /javascript/);
  });
  await t.test('HEAD has headers without a body', async () => {
    const response = await request('/', 'HEAD'); assert.equal(response.status, 200); assert.equal(response.body, '');
  });
  await t.test('rejects unsupported methods', async () => assert.equal((await request('/', 'POST')).status, 405));
});
