const careerCache = require('./career-cache');
const snapshots = require('./career-snapshots');
const slowSync = require('./slow-sync');
const { clearDocentiCache } = require('./docenti-cache');
const { deletePortalCookies } = require('../utils/sessionStore');
const { clearDocentiRouteCache } = require('../routes/docenti');

function clearProfileRuntime(profileId) {
  if (!profileId) return;
  careerCache.clearCareerCache(profileId);
  clearDocentiCache(profileId);
  clearDocentiRouteCache(profileId);
  snapshots.clearSnapshots(profileId);
  slowSync.resetSlowSync(profileId);
  deletePortalCookies(profileId);
}

module.exports = { clearProfileRuntime };
