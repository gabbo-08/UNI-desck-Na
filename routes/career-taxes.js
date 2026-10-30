const express = require('express');
const router = express.Router();
const { getDatiCarriera } = require('../scraper/segrepass');

router.post('/', async (req, res) => {
  const { username, codiceFiscale, password } = req.body;
  const user = codiceFiscale || username;

  if (!user || !password) {
    return res.status(400).json({ success: false, error: 'CREDENTIALS_REQUIRED' });
  }

  try {
    const fullData = await getDatiCarriera(
      { codiceFiscale: user, password },
      { phase: 'slow' }
    );
    res.json({ success: true, data: fullData.tasse });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.code || 'TAXES_ERROR',
      message: error.message
    });
  }
});

module.exports = router;