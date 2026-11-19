const dns = require('node:dns');
const https = require('node:https');
const { BlockList, isIP } = require('node:net');

const privateAddresses = new BlockList();
for (const [address, prefix] of [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8],
  ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24],
  ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24], ['203.0.113.0', 24],
  ['224.0.0.0', 4], ['240.0.0.0', 4]
]) privateAddresses.addSubnet(address, prefix, 'ipv4');
for (const [address, prefix] of [
  ['::', 128], ['::1', 128], ['fc00::', 7], ['fe80::', 10], ['ff00::', 8],
  ['2001:db8::', 32], ['2002::', 16], ['2001::', 32]
]) privateAddresses.addSubnet(address, prefix, 'ipv6');
const globalIpv6 = new BlockList();
globalIpv6.addSubnet('2000::', 3, 'ipv6');
globalIpv6.addSubnet('::ffff:0:0', 96, 'ipv6');

function isPublicPushAddress(address) {
  const family = isIP(address);
  if (!family) return false;
  const type = family === 4 ? 'ipv4' : 'ipv6';
  return !privateAddresses.check(address, type) && (family === 4 || globalIpv6.check(address, type));
}

function validPushEndpoint(value) {
  if (typeof value !== 'string' || value.length > 4096 || /\s/.test(value)) return false;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || !url.hostname || url.username || url.password || url.hash) return false;
    const host = url.hostname.replace(/^\[|\]$/g, '');
    if (isIP(host)) return isPublicPushAddress(host);
    return host !== 'localhost' && !host.endsWith('.localhost') && !host.endsWith('.local');
  } catch {
    return false;
  }
}

function validPushSubscription(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value) &&
    validPushEndpoint(value.endpoint) && value.keys &&
    typeof value.keys.p256dh === 'string' && value.keys.p256dh.length > 0 && value.keys.p256dh.length <= 512 &&
    typeof value.keys.auth === 'string' && value.keys.auth.length > 0 && value.keys.auth.length <= 512);
}

function unsafeEndpointError() {
  const error = new Error('La destinazione push non è un indirizzo pubblico.');
  error.code = 'PUSH_ENDPOINT_UNSAFE';
  return error;
}

function createPublicPushLookup(lookup = dns.lookup) {
  return (hostname, options, callback) => {
    const settings = typeof options === 'number' ? { family: options } : (options || {});
    // La verifica avviene nel lookup del socket, evitando un secondo lookup
    // non controllato fra la validazione DNS e l'invio della richiesta.
    lookup(hostname, { ...settings, all: true }, (error, addresses) => {
      if (error) return callback(error);
      if (!addresses?.length || addresses.some(item => !isPublicPushAddress(item.address))) {
        return callback(unsafeEndpointError());
      }
      if (settings.all) return callback(null, addresses);
      return callback(null, addresses[0].address, addresses[0].family);
    });
  };
}

const publicPushAgent = new https.Agent({ lookup: createPublicPushLookup() });

module.exports = { validPushEndpoint, validPushSubscription, isPublicPushAddress, createPublicPushLookup, publicPushAgent };
