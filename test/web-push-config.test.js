const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const webPush = require('../services/web-push');

function withEnvironment(values, callback) {
  const names = ['PUSH_VAPID_SUBJECT', 'PUSH_VAPID_PUBLIC_KEY', 'PUSH_VAPID_PRIVATE_KEY'];
  const previous = Object.fromEntries(names.map(name => [name, process.env[name]]));
  try {
    for (const name of names) {
      if (Object.prototype.hasOwnProperty.call(values, name)) process.env[name] = values[name];
      else delete process.env[name];
    }
    return callback();
  } finally {
    for (const name of names) {
      if (previous[name] === undefined) delete process.env[name];
      else process.env[name] = previous[name];
    }
  }
}

test('Web Push resta disabilitato senza il set completo di chiavi VAPID', () => {
  withEnvironment({}, () => {
    assert.equal(webPush.isWebPushConfigured(), false);
    assert.equal(webPush.vapidPublicKey(), null);
  });
});

test('la documentazione push esplicita consenso, segreti VAPID e worker protetto', () => {
  const documentation = fs.readFileSync(path.join(__dirname, '..', 'docs', 'aggiornamenti', 'PUSH_NOTIFICHE.md'), 'utf8');
  assert.match(documentation, /consenso esplicito/i);
  assert.match(documentation, /PUSH_VAPID_PRIVATE_KEY/);
  assert.match(documentation, /secret manager/i);
  assert.match(documentation, /worker\/cron protetto/i);
  assert.match(documentation, /404\/410/);
});
