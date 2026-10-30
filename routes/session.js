const express = require('express');
const { createStudentSession } = require('../services/student-session');
const { sessionErrorStatus, sessionErrorMessage } = require('../lib/errors');

const router = express.Router();

router.post('/', async (req, res) => {
  try {
    const session = await createStudentSession(req.body || {});
    return res.json(session);
  } catch (error) {
    console.error('[Session Error]', error.message);
    return res.status(sessionErrorStatus(error)).json({ error: sessionErrorMessage(error) });
  }
});

module.exports = router;
