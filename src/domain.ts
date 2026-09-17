export type MeasurementMode = "camera" | "map" | "manual";
export type CleaningPlan = "quick" | "premium" | "annihilator";

export type Job = {
  id: number;
  address: string;
  area: number;
  infill: number;
  quote: number;
  status: string;
  method: MeasurementMode;
  createdAt: string;
  photos: number;
};

export type CommunityPost = {
  id: number;
  name: string;
  author: string;
  body: string;
  replies: number;
  age: string;
  category?: string;
  likes?: number;
  liked?: boolean;
  saved?: boolean;
  pinned?: boolean;
  following?: boolean;
  media?: "photo" | "poll";
};

export type CommunityComment = {
  id: number;
  postId: number;
  author: string;
  body: string;
  age: string;
  likes: number;
  liked?: boolean;
  answer?: boolean;
};

export type Lesson = {
  id: string;
  title: string;
  duration: string;
  type: "video" | "guide" | "quiz";
  completed: boolean;
  locked?: boolean;
};

export type Course = {
  id: string;
  title: string;
  description: string;
  category: string;
  instructor: string;
  progress: number;
  duration: string;
  modules: { title: string; lessons: Lesson[] }[];
  access: "open" | "level" | "purchase";
  requiredLevel?: number;
};

export type AcademyEvent = {
  id: number;
  title: string;
  description: string;
  date: string;
  time: string;
  duration: string;
  host: string;
  kind: "live" | "workshop" | "office-hours";
  attending: boolean;
  attendeeCount: number;
};

export type Member = {
  id: number;
  name: string;
  initials: string;
  company: string;
  location: string;
  role: "Owner" | "Admin" | "Moderator" | "Operator";
  level: number;
  points: number;
  following: boolean;
  online?: boolean;
};

export type AppNotification = {
  id: number;
  title: string;
  detail: string;
  age: string;
  kind: "reply" | "like" | "event" | "course" | "admin";
  read: boolean;
};

export type QuoteDraft = {
  address: string;
  mode: MeasurementMode;
  length: number;
  width: number;
  cameraArea: number;
  mapArea: number;
  serviceRate: number;
  infillRate: number;
};

export type QuoteTotals = {
  area: number;
  infillPounds: number;
  bags40: number;
  bags50: number;
  infillBags: number;
  serviceSubtotal: number;
  total: number;
};
