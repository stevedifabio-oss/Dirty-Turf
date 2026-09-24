import type { CommunityPost, Member } from "../domain";

export const academyChannels = [
  "Announcements",
  "Start Here",
  "General",
  "Turf Help",
  "Chemistry & Cleaners",
  "Infill",
  "Equipment",
  "Marketing",
  "Sales",
  "Business",
  "Job Help",
  "Member Wins",
  "Myth Busters",
  "Products",
  "Completed Jobs",
] as const;

export function communityChannels(posts: CommunityPost[]) {
  const counts = new Map<string, number>();
  for (const post of posts) {
    const channel = post.category?.trim();
    if (channel) counts.set(channel, (counts.get(channel) ?? 0) + 1);
  }

  const names = Array.from(new Set([...academyChannels, ...counts.keys()]));
  return names.map((name) => ({ name, count: counts.get(name) ?? 0 }));
}

export function featuredCommunityPost(posts: CommunityPost[]) {
  return posts
    .filter((post) => post.pinned)
    .sort((a, b) => (b.likes ?? 0) - (a.likes ?? 0))[0];
}

export function postsFromFollowedMembers(posts: CommunityPost[], members: Member[]) {
  const followedIds = new Set(members.filter((member) => member.following && member.cloudId).map((member) => member.cloudId));
  const followedNames = new Set(members.filter((member) => member.following && !member.cloudId).map((member) => member.name.toLocaleLowerCase()));
  return posts.filter((post) => post.authorCloudId ? followedIds.has(post.authorCloudId) : followedNames.has(post.author.toLocaleLowerCase()));
}

export function communityLeaders(members: Member[], limit = 4) {
  return [...members]
    .sort((a, b) => b.points - a.points || b.level - a.level || a.name.localeCompare(b.name))
    .slice(0, Math.max(0, limit));
}

export function communityStats(posts: CommunityPost[], members: Member[]) {
  return {
    members: members.length,
    posts: posts.length,
    admins: members.filter((member) => member.role === "Admin" || member.role === "Moderator").length,
  };
}
