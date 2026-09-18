import type { AcademyEvent, AppNotification, CommunityComment, CommunityPost, Course, Member } from "./domain";

export const courses: Course[] = [
  {
    id: "odor-systems",
    title: "Odor removal systems",
    description: "Diagnose odor at the source and run the complete Dirty Turf extraction process.",
    category: "Core",
    instructor: "Steve",
    progress: 72,
    duration: "1h 42m",
    access: "open",
    modules: [
      { title: "Diagnose the yard", lessons: [
        { id: "odor-1", title: "Why turf holds odor", duration: "7 min", type: "video", completed: true },
        { id: "odor-2", title: "Inspect drainage and infill", duration: "9 min", type: "video", completed: true },
        { id: "odor-3", title: "Field diagnosis checklist", duration: "4 min", type: "guide", completed: true },
      ] },
      { title: "Extract and neutralize", lessons: [
        { id: "odor-4", title: "Pre-treatment ratios", duration: "11 min", type: "video", completed: true },
        { id: "odor-5", title: "Truck-mount extraction pass", duration: "14 min", type: "video", completed: false },
        { id: "odor-6", title: "Knowledge check", duration: "5 min", type: "quiz", completed: false },
      ] },
    ],
  },
  {
    id: "pet-restoration",
    title: "Pet turf restoration",
    description: "Restore high-use pet yards with worn fibers, compacted infill, and stubborn contamination.",
    category: "Advanced",
    instructor: "Mike",
    progress: 44,
    duration: "58m",
    access: "level",
    requiredLevel: 2,
    modules: [
      { title: "Assessment", lessons: [
        { id: "pet-1", title: "Contamination mapping", duration: "8 min", type: "video", completed: true },
        { id: "pet-2", title: "Fiber and seam inspection", duration: "10 min", type: "video", completed: true },
      ] },
      { title: "Restoration", lessons: [
        { id: "pet-3", title: "Deep extraction sequence", duration: "13 min", type: "video", completed: false },
        { id: "pet-4", title: "Rebloom and replenish", duration: "12 min", type: "video", completed: false },
      ] },
    ],
  },
  {
    id: "commercial-routes",
    title: "Commercial maintenance routes",
    description: "Plan repeatable commercial service with clear scope, crew standards, and account notes.",
    category: "Operations",
    instructor: "Maya R.",
    progress: 19,
    duration: "46m",
    access: "open",
    modules: [
      { title: "Route setup", lessons: [
        { id: "route-1", title: "Scope commercial turf", duration: "9 min", type: "video", completed: true },
        { id: "route-2", title: "Build the service plan", duration: "12 min", type: "guide", completed: false },
        { id: "route-3", title: "Crew handoff", duration: "8 min", type: "video", completed: false },
      ] },
    ],
  },
  {
    id: "profitable-quotes",
    title: "Quoting profitable cleanings",
    description: "Turn measured area, conditions, materials, and labor into a quote that protects margin.",
    category: "Sales",
    instructor: "Andre S.",
    progress: 0,
    duration: "38m",
    access: "open",
    modules: [
      { title: "Quote the work", lessons: [
        { id: "quote-1", title: "Set your service rate", duration: "7 min", type: "video", completed: false },
        { id: "quote-2", title: "Calculate infill", duration: "8 min", type: "guide", completed: false },
        { id: "quote-3", title: "Handle price objections", duration: "11 min", type: "video", completed: false },
      ] },
    ],
  },
];

export const initialPosts: CommunityPost[] = [
  { id: 1, name: "Route pricing for shaded pet yards", author: "Maya R.", body: "How are you pricing quarterly cleanings when the homeowner has two dogs and heavy shade? I am seeing slower dry times and more compaction.", replies: 3, likes: 24, age: "24 min", category: "Pricing", pinned: true, following: true },
  { id: 2, name: "Before and after review: 1,200 sq ft", author: "Chris D.", body: "Old infill, two seams lifting, and a concentrated pet area near the patio. What would you quote for the restoration pass?", replies: 2, likes: 17, age: "2 hr", category: "Job review", media: "photo" },
  { id: 3, name: "Crew setup that cut return trips", author: "Andre S.", body: "We moved the enzyme mix and sprayer check to the start of the route. Fewer return trips already. Posting the four-step checklist here.", replies: 1, likes: 31, age: "Yesterday", category: "Operations", saved: true },
  { id: 4, name: "Which power broom direction first?", author: "Tasha V.", body: "On older S-blade turf, do you cross-brush before extraction or save the second direction for the finish pass?", replies: 5, likes: 12, age: "Yesterday", category: "Equipment" },
];

export const initialComments: CommunityComment[] = [
  { id: 11, postId: 1, author: "Steve B.", body: "Add the extra dwell and extraction time to the scope. Shade is not a discount when it creates more work.", age: "12 min", likes: 9, answer: true },
  { id: 12, postId: 1, author: "Chris D.", body: "We also log dog count and drainage before applying the quarterly rate.", age: "7 min", likes: 4 },
  { id: 13, postId: 1, author: "Maya R.", body: "That helps. I was underweighting the second extraction pass.", age: "2 min", likes: 2 },
  { id: 21, postId: 2, author: "Andre S.", body: "I would separate seam repair from the clean and show both line items.", age: "1 hr", likes: 5, answer: true },
  { id: 22, postId: 2, author: "Tasha V.", body: "Premium clean plus fresh infill, then inspect after the first extraction.", age: "38 min", likes: 3 },
  { id: 31, postId: 3, author: "Maya R.", body: "The water-access check at dispatch has been huge for us too.", age: "Yesterday", likes: 7 },
];

export const initialEvents: AcademyEvent[] = [
  { id: 1, title: "Live job review", description: "Bring one estimate or difficult property. We will review scope, treatment, and pricing together.", date: "Sep 18", time: "9:00 AM", duration: "45 min", host: "Steve", kind: "live", attending: true, attendeeCount: 46 },
  { id: 2, title: "Odor diagnosis workshop", description: "A practical walkthrough for finding the source before you choose chemistry or extraction passes.", date: "Sep 22", time: "2:00 PM", duration: "60 min", host: "Mike", kind: "workshop", attending: false, attendeeCount: 31 },
  { id: 3, title: "Operator office hours", description: "Open questions about equipment, routes, staffing, and difficult customer conversations.", date: "Sep 25", time: "11:30 AM", duration: "30 min", host: "Maya", kind: "office-hours", attending: false, attendeeCount: 18 },
];

export const initialMembers: Member[] = [
  { id: 1, name: "Maya Rodriguez", initials: "MR", company: "Desert Turf Care", location: "Mesa, AZ", role: "Moderator", level: 7, points: 1840, following: true, online: true },
  { id: 2, name: "Chris Daniels", initials: "CD", company: "Fresh Yard Co.", location: "Las Vegas, NV", role: "Owner", level: 6, points: 1510, following: false },
  { id: 3, name: "Andre Smith", initials: "AS", company: "Green Route Pros", location: "Chandler, AZ", role: "Owner", level: 5, points: 1285, following: true, online: true },
  { id: 4, name: "Tasha Vega", initials: "TV", company: "Clean Blade Turf", location: "Gilbert, AZ", role: "Operator", level: 4, points: 910, following: false },
  { id: 5, name: "Jordan Lee", initials: "JL", company: "Westside Turf Works", location: "Peoria, AZ", role: "Operator", level: 3, points: 720, following: false, online: true },
];

export const initialNotifications: AppNotification[] = [
  { id: 1, title: "Steve marked an answer", detail: "Route pricing for shaded pet yards", age: "8 min", kind: "reply", read: false },
  { id: 2, title: "12 operators liked your checklist", detail: "Crew setup that cut return trips", age: "1 hr", kind: "like", read: false },
  { id: 3, title: "Live job review starts tomorrow", detail: "You are attending at 9:00 AM", age: "3 hr", kind: "event", read: false },
  { id: 4, title: "New lesson available", detail: "Truck-mount extraction pass", age: "Yesterday", kind: "course", read: true },
];
