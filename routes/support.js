const express = require('express');
const crypto = require('node:crypto');
const { saveSupportReport } = require('../db/repository');

const router = express.Router();
const CATEGORIES = new Set(['bug', 'materiali', 'docenti', 'carriera', 'privacy', 'altro']);

function cleanContext(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const allowed = ['screen', 'appVersion', 'route', 'code'];
  return Object.fromEntries(allowed
    .filter(key => typeof value[key] === 'string')
    .map(key => [key, String(value[key]).slice(0, 120)]));
}

function redactDescription(value) {
  return String(value || '').replace(/\b(password|passphrase|token|cred[_-]?key)\s*[:=]\s*[^\s,;]+/gi, '$1=[redacted]');
}

router.post('/report', (req, res) => {
  const body = req.body || {};
  const category = String(body.category || 'altro').trim().toLowerCase();
  const description = redactDescription(body.description).trim();
  if (!CATEGORIES.has(category) || description.length < 10 || description.length > 2000) {
    return res.status(400).json({ error: 'Segnalazione non valida.', code: 'SUPPORT_REPORT_INVALID' });
  }

  const reportId = crypto.randomUUID();
  saveSupportReport({
    id: reportId,
    profileId: req.user.sub,
    category,
    description,
    context: cleanContext(body.context)
  });
  return res.status(202).json({ accepted: true, reportId, requestId: req.requestId });
});

module.exports = router;
