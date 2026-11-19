const test = require('node:test');
const assert = require('node:assert/strict');
const { validPushEndpoint, isPublicPushAddress, createPublicPushLookup } = require('../lib/push-subscription');

test('gli endpoint push richiedono URL HTTPS validi senza credenziali o destinazioni locali', () => {
  assert.equal(validPushEndpoint('https://push.example.test/subscription'), true);
  for (const value of [
    'https://', 'http://push.example.test/x', 'https://user:pass@push.example.test/x',
    'https://push.example.test/x#secret', 'https://push.example.test/\ninvalid',
    'https://localhost/x', 'https://printer.local/x', 'https://127.0.0.1/x',
    'https://2130706433/x', 'https://169.254.169.254/x', 'https://10.0.0.1/x',
    'https://[::1]/x', 'https://[::ffff:127.0.0.1]/x', 'https://[fc00::1]/x'
  ]) assert.equal(validPushEndpoint(value), false, value);
});

test('il lookup del socket blocca DNS privati, misti e IPv4 mappati in IPv6', async () => {
  for (const address of ['127.0.0.1', '192.168.1.2', '::1', '::ffff:7f00:1', 'fe80::1', '100.64.0.1']) {
    assert.equal(isPublicPushAddress(address), false, address);
    const lookup = createPublicPushLookup((_hostname, _options, callback) => callback(null, [
      { address: '8.8.8.8', family: 4 }, { address, family: address.includes(':') ? 6 : 4 }
    ]));
    await new Promise(resolve => lookup('push.example.test', { all: true }, error => {
      assert.equal(error?.code, 'PUSH_ENDPOINT_UNSAFE');
      resolve();
    }));
  }
});

test('il lookup pubblico conserva i formati Node con un indirizzo o con all', async () => {
  const addresses = [{ address: '8.8.8.8', family: 4 }, { address: '2606:4700:4700::1111', family: 6 }];
  const lookup = createPublicPushLookup((_hostname, _options, callback) => callback(null, addresses));
  await new Promise(resolve => lookup('push.example.test', {}, (error, address, family) => {
    assert.equal(error, null);
    assert.equal(address, addresses[0].address);
    assert.equal(family, 4);
    resolve();
  }));
  await new Promise(resolve => lookup('push.example.test', { all: true }, (error, result) => {
    assert.equal(error, null);
    assert.deepEqual(result, addresses);
    resolve();
  }));
});
