const { seal, open } = require('./secret-box');

const COOKIE_NAME = 'segrepass_profile_prefs';
const MAX_AGE_SECONDS = 365 * 24 * 60 * 60;

function parseCookies(header = '') {
  const out = {};
  for (const part of String(header || '').split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const key = part.slice(0, idx).trim();
    const val = part.slice(idx + 1).trim();
    if (key) out[key] = val;
  }
  return out;
}

function writeProfilePrefsCookie(res, profileId, profile) {
  if (!res || !profileId || !profile) return;
  const payload = {
    profileId: String(profileId).trim().toUpperCase(),
    courseId: profile.course_id || profile.courseId || null,
    courseName: profile.course_name || profile.courseName || null,
    cohortYear: profile.cohort_year || profile.cohortYear || null,
    currentCourseYear: profile.current_course_year || profile.currentCourseYear || null,
    channel: profile.channel || null,
    surnameInitial: profile.surname_initial || profile.surnameInitial || null
  };
  const sealed = seal(JSON.stringify(payload), 'profile-prefs-cookie');
  const isProd = String(process.env.NODE_ENV || '').toLowerCase() === 'production';
  const attrs = [
    `${COOKIE_NAME}=${encodeURIComponent(sealed)}`,
    'Path=/',
    `Max-Age=${MAX_AGE_SECONDS}`,
    'HttpOnly',
    isProd ? 'SameSite=None; Secure' : 'SameSite=Lax'
  ].join('; ');
  const prev = res.getHeader('Set-Cookie');
  if (!prev) res.setHeader('Set-Cookie', attrs);
  else if (Array.isArray(prev)) res.setHeader('Set-Cookie', [...prev, attrs]);
  else res.setHeader('Set-Cookie', [String(prev), attrs]);
}

function readProfilePrefsCookie(req, profileId) {
  if (!req || !profileId) return null;
  const cookies = parseCookies(req.headers?.cookie);
  const raw = cookies[COOKIE_NAME];
  if (!raw) return null;
  try {
    const parsed = JSON.parse(open(decodeURIComponent(raw), 'profile-prefs-cookie') || 'null');
    if (!parsed || parsed.profileId !== String(profileId).trim().toUpperCase()) return null;
    const updates = {};
    if (parsed.courseId) updates.courseId = parsed.courseId;
    if (parsed.courseName) updates.courseName = parsed.courseName;
    if (parsed.cohortYear) updates.cohortYear = Number(parsed.cohortYear);
    if (parsed.currentCourseYear) updates.currentCourseYear = Number(parsed.currentCourseYear);
    if (parsed.channel) updates.channel = parsed.channel;
    if (parsed.surnameInitial) updates.surnameInitial = parsed.surnameInitial;
    return Object.keys(updates).length ? updates : null;
  } catch {
    return null;
  }
}

module.exports = { writeProfilePrefsCookie, readProfilePrefsCookie };
