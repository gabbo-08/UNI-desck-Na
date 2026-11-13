function toProfileDto(profile) {
  if (!profile) return null;
  return {
    id: profile.id,
    matricola: profile.matricola || null,
    course_id: profile.course_id || null,
    course_name: profile.course_name || null,
    cohort_year: profile.cohort_year || null,
    current_course_year: profile.current_course_year || null,
    channel: profile.channel || null,
    surname_initial: profile.surname_initial || null,
    updated_at: profile.updated_at || null
  };
}

function toSessionDto(profile) {
  return {
    authenticated: true,
    profile: toProfileDto(profile),
    onboardingRequired: !(
      profile?.course_id && profile?.course_name && profile?.cohort_year &&
      profile?.current_course_year && (profile?.channel || profile?.surname_initial)
    )
  };
}

function toLoginDto(session) {
  const profileDto = toProfileDto(session.profile);
  return {
    authenticated: true,
    profileId: session.profileId,
    profile: profileDto,
    onboardingRequired: toSessionDto(session.profile).onboardingRequired,
    fromCache: Boolean(session.fromCache),
    slowSync: session.slowSync,
    docentiLoading: Boolean(session.docentiLoading),
    docentiReason: session.docentiReason || null,
    metriche: session.metriche
  };
}

module.exports = { toProfileDto, toSessionDto, toLoginDto };
