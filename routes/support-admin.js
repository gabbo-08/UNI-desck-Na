const express = require('express');
const { getSupportReports } = require('../db/repository');
const { supportAdminAuthorized } = require('../lib/support-admin');

function createSupportAdminRouter(env = process.env) {
  const router = express.Router();

  router.get('/reports', (req, res) => {
    if (!supportAdminAuthorized(req, env)) {
      return res.status(404).json({ error: 'Risorsa non disponibile.' });
    }
    const reports = getSupportReports({ limit: req.query.limit });
    return res.json({ reports });
  });

  return router;
}

module.exports = { createSupportAdminRouter };
