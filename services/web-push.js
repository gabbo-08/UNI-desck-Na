const webpush = require('web-push');
const { getPushSubscriptions, deletePushSubscription } = require('../db/repository');
const { publicPushAgent } = require('../lib/push-subscription');

let configured = false;

function configureWebPush() {
  if (configured) return true;
  const subject = String(process.env.PUSH_VAPID_SUBJECT || '').trim();
  const publicKey = String(process.env.PUSH_VAPID_PUBLIC_KEY || '').trim();
  const privateKey = String(process.env.PUSH_VAPID_PRIVATE_KEY || '').trim();
  if (!subject || !publicKey || !privateKey) return false;
  webpush.setVapidDetails(subject, publicKey, privateKey);
  configured = true;
  return true;
}

function isWebPushConfigured() {
  return configureWebPush();
}

function vapidPublicKey() {
  return isWebPushConfigured() ? String(process.env.PUSH_VAPID_PUBLIC_KEY || '') : null;
}

async function sendPushToProfile(profileId, payload, database) {
  if (!isWebPushConfigured()) {
    const error = new Error('Web Push non configurato.');
    error.code = 'PUSH_NOT_CONFIGURED';
    error.status = 503;
    throw error;
  }
  const subscriptions = getPushSubscriptions(profileId, database);
  const body = JSON.stringify({
    title: String(payload?.title || 'UniDesk NA').slice(0, 120),
    body: String(payload?.body || '').slice(0, 500),
    url: typeof payload?.url === 'string' && payload.url.startsWith('/') ? payload.url : '/',
    tag: String(payload?.tag || 'unidesk-na').slice(0, 80)
  });
  const results = await Promise.allSettled(subscriptions.map(async subscription => {
    try {
      await webpush.sendNotification(subscription, body, { TTL: 3600, timeout: 10000, agent: publicPushAgent });
      return { sent: true };
    } catch (error) {
      if ([404, 410].includes(Number(error?.statusCode))) {
        deletePushSubscription(profileId, subscription.endpoint, database);
      }
      return { sent: false, status: error?.statusCode || 0 };
    }
  }));
  return {
    configured: true,
    subscriptions: subscriptions.length,
    sent: results.filter(item => item.status === 'fulfilled' && item.value.sent).length
  };
}

module.exports = { isWebPushConfigured, vapidPublicKey, sendPushToProfile };
