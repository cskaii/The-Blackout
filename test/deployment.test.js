const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { backendOrigin, build } = require('../scripts/buildFrontend');

test('frontend build rejects unsafe backend origins', () => {
  assert.equal(backendOrigin(' https://blackout-example.onrender.com/ '), 'https://blackout-example.onrender.com');
  for (const value of ['', 'http://example.com', 'https://key@example.com', 'https://example.com/api', 'https://example.com?key=secret', 'https://example.com/#token']) assert.throws(() => backendOrigin(value));
});

test('built frontend includes the full game and audio assets but no backend or secrets', () => {
  const previous = process.env.BACKEND_URL;
  process.env.BACKEND_URL = 'https://blackout-example.onrender.com';
  try {
    build();
    const html = fs.readFileSync('dist/index.html', 'utf8');
    for (const file of ['app.js', 'config.js', 'sound.js', 'mission.css', 'style.css']) {
      assert.ok(fs.existsSync('dist/' + file)); assert.ok(html.includes('"' + file + '"'));
    }
    assert.ok(html.indexOf('src="sound.js"') < html.indexOf('src="app.js"'));
    assert.match(html, /id="monitoring-dashboard"[^>]+hidden/);
    for (const privatePath of ['.env', 'backend', 'node_modules']) assert.equal(fs.existsSync('dist/' + privatePath), false);
    assert.match(fs.readFileSync('dist/config.js', 'utf8'), /https:\/\/blackout-example.onrender.com/);
  } finally {
    if (previous === undefined) delete process.env.BACKEND_URL; else process.env.BACKEND_URL = previous;
  }
});
