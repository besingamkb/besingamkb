import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile } from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { test } from 'node:test';

const execFileAsync = promisify(execFile);

test('generator excludes forks and counts primary languages across original repositories', async () => {
  const repositories = [
    { name: 'new-tool', fork: false, archived: false, stargazers_count: 3, language: 'Rust', created_at: '2026-01-01T00:00:00Z', pushed_at: '2026-09-01T00:00:00Z' },
    { name: 'web-tool', fork: false, archived: false, stargazers_count: 2, language: 'TypeScript', created_at: '2020-01-01T00:00:00Z', pushed_at: '2026-08-01T00:00:00Z' },
    { name: 'forked-php', fork: true, archived: false, stargazers_count: 99, language: 'PHP', created_at: '2018-01-01T00:00:00Z', pushed_at: '2026-07-01T00:00:00Z' },
  ];
  const server = http.createServer((request, response) => {
    response.setHeader('content-type', 'application/json');
    if (request.url === '/users/besingamkb') return response.end(JSON.stringify({ public_repos: 3, followers: 4, created_at: '2014-01-12T00:00:00Z' }));
    if (request.url?.startsWith('/users/besingamkb/repos?')) return response.end(JSON.stringify(repositories));
    response.statusCode = 404;
    response.end('{}');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));

  try {
    const tempDirectory = await mkdtemp(path.join(os.tmpdir(), 'profile-telemetry-'));
    const output = path.join(tempDirectory, 'telemetry.svg');
    const address = server.address();
    await execFileAsync(process.execPath, ['scripts/generate-telemetry.mjs'], {
      cwd: path.resolve(import.meta.dirname, '..'),
      env: { ...process.env, GITHUB_API_URL: `http://127.0.0.1:${address.port}`, TELEMETRY_OUTPUT_PATH: output },
    });
    const svg = await readFile(output, 'utf8');
    assert.match(svg, />3<\/text><text class="metric-label" y="342">PUBLIC REPOS/);
    assert.match(svg, />2<\/text><text class="metric-label" y="342">ORIGINAL BUILDS/);
    assert.match(svg, />5<\/text><text class="metric-label" y="342">ORIGINAL STARS/);
    assert.match(svg, /Rust 50\.0%/);
    assert.match(svg, /TypeScript 50\.0%/);
    assert.doesNotMatch(svg, /PHP 99|forked-php/);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});
