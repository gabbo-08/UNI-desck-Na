const express = require('express');
const { savePushSubscription, deletePushSubscription } = require('../db/repository');
const { isWebPushConfigured, vapidPublicKey, sendPushToProfile } = require('../services/web-push');

const router = express.Router();

function validSubscription(value) {
  return value && typeof value === 'object' &&
    typeof value.endpoint === 'string' && /^https:\/\//i.test(value.endpoint) &&
    value.keys && typeof value.keys.p256dh === 'string' && typeof value.keys.auth === 'string';
}

router.get('/vapid-public-key', (req, res) => {
  const publicKey = vapidPublicKey();
  if (!publicKey) return res.status(503).json({ configured: false, code: 'PUSH_NOT_CONFIGURED' });
  return res.json({ configured: true, publicKey });
});

router.post('/subscribe', (req, res) => {
  const subscription = req.body?.subscription;
  if (!validSubscription(subscription)) {
    return res.status(400).json({ error: 'Sottoscrizione push non valida.', code: 'PUSH_SUBSCRIPTION_INVALID' });
  }
  if (!savePushSubscription(req.user.sub, subscription, undefined, req.get('user-agent'))) {
    return res.status(400).json({ error: 'Sottoscrizione push non salvata.', code: 'PUSH_SUBSCRIPTION_INVALID' });
  }
  return res.status(201).json({ subscribed: true });
});

router.delete('/subscribe', (req, res) => {
  const endpoint = req.body?.endpoint;
  if (typeof endpoint !== 'string' || !/^https:\/\//i.test(endpoint)) {
    return res.status(400).json({ error: 'Endpoint push non valido.', code: 'PUSH_ENDPOINT_INVALID' });
  }
  deletePushSubscription(req.user.sub, endpoint);
  return res.status(204).end();
});

// Endpoint esplicito di verifica: non viene chiamato automaticamente e invia
// solo un messaggio generico, senza dati personali.
router.post('/test', async (req, res) => {
  try {
    const result = await sendPushToProfile(req.user.sub, {
      title: 'UniDesk NA',
      body: 'Notifiche push configurate correttamente.',
      url: '/',
      tag: 'push-test'
    });
    return res.json(result);
  } catch (error) {
    return res.status(error.status || 503).json({ error: error.message || 'Notifica push non disponibile.', code: error.code || 'PUSH_SEND_FAILED' });
  }
});

module.exports = router;
