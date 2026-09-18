const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function auditAcademyAccess(manifest, expectations = {}) {
  const members = Array.isArray(manifest?.members) ? manifest.members : [];
  const enrollments = Array.isArray(manifest?.enrollments) ? manifest.enrollments : [];
  const memberById = new Map(members.map((member) => [member.externalId, member]));
  const loginMembers = members.filter((member) => (member.status ?? "active") === "active" && validEmail(member.email));
  const loginEmails = loginMembers.map((member) => normalizeEmail(member.email));
  const uniqueEmails = new Set(loginEmails);
  const duplicateEmailCount = loginEmails.length - uniqueEmails.size;
  const activeEnrollments = enrollments.filter((enrollment) =>
    ["active", "completed"].includes(enrollment.status ?? "active")
  );
  const enrolledMemberIds = new Set(activeEnrollments.map((enrollment) => enrollment.memberExternalId));
  const failures = [];

  for (const memberId of enrolledMemberIds) {
    const member = memberById.get(memberId);
    if (!member) failures.push(`Enrollment references missing member ${memberId}`);
    else if ((member.status ?? "active") !== "active") failures.push(`Enrolled member ${memberId} is not active`);
    else if (!validEmail(member.email)) failures.push(`Enrolled member ${memberId} has no valid login email`);
  }
  if (duplicateEmailCount) failures.push(`${duplicateEmailCount} active member email is duplicated`);
  if (expectations.members !== undefined && uniqueEmails.size !== expectations.members) {
    failures.push(`Expected ${expectations.members} login-ready members but found ${uniqueEmails.size}`);
  }
  if (expectations.enrolled !== undefined && enrolledMemberIds.size !== expectations.enrolled) {
    failures.push(`Expected ${expectations.enrolled} enrolled members but found ${enrolledMemberIds.size}`);
  }

  const enrolledLoginReady = Array.from(enrolledMemberIds).filter((memberId) => {
    const member = memberById.get(memberId);
    return member && (member.status ?? "active") === "active" && validEmail(member.email);
  }).length;

  return {
    valid: failures.length === 0,
    counts: {
      sourceMembers: members.length,
      uniqueLoginEmails: uniqueEmails.size,
      activeEnrollments: enrolledMemberIds.size,
      enrolledLoginReady,
      duplicateEmailCount,
    },
    allEnrolledCanLogin: enrolledMemberIds.size > 0 && enrolledLoginReady === enrolledMemberIds.size,
    failures,
  };
}

function normalizeEmail(value) {
  return String(value ?? "").trim().toLocaleLowerCase("en-US");
}

function validEmail(value) {
  return emailPattern.test(normalizeEmail(value));
}
