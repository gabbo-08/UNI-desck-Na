import type { PlanCourse } from '@/lib/api';

type TeacherCourseRecord = {
  courseCode?: string | null;
  courseName?: string;
  insegnamento?: string | null;
  professor?: string | null;
  section?: string | null;
};

function normalizeCode(value?: string | null): string {
  return String(value || '').trim().toLowerCase();
}

export function filterTeacherSubscriptions<T extends TeacherCourseRecord>(
  subscriptions: T[],
  planCourses: PlanCourse[]
): T[] {
  const allowedCodes = new Set(
    planCourses
      .map(course => normalizeCode(course.courseCode || course.course_name))
      .filter(Boolean)
  );
  const seen = new Set<string>();

  return subscriptions.filter(subscription => {
    const code = normalizeCode(subscription.courseCode);
    if (allowedCodes.size > 0 && (!code || !allowedCodes.has(code))) return false;
    const key = [
      code,
      normalizeCode(subscription.courseName || subscription.insegnamento),
      normalizeCode(subscription.professor),
      normalizeCode(subscription.section),
    ].join('|');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
