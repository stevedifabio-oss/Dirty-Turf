import { describe, expect, it } from "vitest";
import type { CommunityPost, Member } from "../domain";
import { communityChannels, communityLeaders, communityStats, featuredCommunityPost } from "./communityOverview";

const posts: CommunityPost[] = [
  { id: 1, name: "Pinned", author: "A", body: "", replies: 0, age: "Now", category: "General", likes: 3, pinned: true },
  { id: 2, name: "Popular pin", author: "B", body: "", replies: 0, age: "Now", category: "Custom", likes: 8, pinned: true },
  { id: 3, name: "Regular", author: "C", body: "", replies: 0, age: "Now", category: "General", likes: 20 },
];

const members: Member[] = [
  { id: 1, name: "Low", initials: "LO", company: "", location: "", role: "Owner", level: 2, points: 10, following: false },
  { id: 2, name: "Admin", initials: "AD", company: "", location: "", role: "Admin", level: 4, points: 50, following: false },
  { id: 3, name: "Moderator", initials: "MO", company: "", location: "", role: "Moderator", level: 3, points: 30, following: false },
];

describe("community overview selectors", () => {
  it("keeps the Academy channel order and appends imported channels with accurate counts", () => {
    const channels = communityChannels(posts);
    expect(channels[0]).toEqual({ name: "Announcements", count: 0 });
    expect(channels.find((channel) => channel.name === "General")?.count).toBe(2);
    expect(channels.at(-1)).toEqual({ name: "Custom", count: 1 });
  });

  it("uses the most-liked pinned post as the featured discussion", () => {
    expect(featuredCommunityPost(posts)?.id).toBe(2);
    expect(featuredCommunityPost(posts.filter((post) => !post.pinned))).toBeUndefined();
  });

  it("derives leaderboard and group totals from current member data", () => {
    expect(communityLeaders(members, 2).map((member) => member.name)).toEqual(["Admin", "Moderator"]);
    expect(communityStats(posts, members)).toEqual({ members: 3, posts: 3, admins: 2 });
  });
});
