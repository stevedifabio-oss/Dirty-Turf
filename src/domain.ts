export type MeasurementMode = "camera" | "map" | "manual";

export type Job = {
  id: number;
  address: string;
  area: number;
  preciseArea?: number;
  infill: number;
  infillPounds?: number;
  bags50?: number;
  infillRate?: number;
  serviceRate?: number;
  quote: number;
  status: string;
  method: MeasurementMode;
  createdAt: string;
  photos: number;
};

export type CommunityPost = {
  id: number;
  cloudId?: string;
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
  cloudId?: string;
  postId: number;
  author: string;
  body: string;
  age: string;
  likes: number;
  liked?: boolean;
  answer?: boolean;
};

export type LessonQuizOption = {
  text: string;
  html?: string;
};

export type LessonQuizQuestion = {
  prompt: string;
  promptHtml?: string;
  options: LessonQuizOption[];
  explanation?: string;
  explanationHtml?: string;
  correctOptionIndex?: number;
};

export type LessonQuiz = {
  name: string;
  requiresPassing: boolean;
  passingPercent?: number;
  completionMessage?: string;
  questions: LessonQuizQuestion[];
};

export type Lesson = {
  id: string;
  cloudId?: string;
  title: string;
  duration: string;
  type: "video" | "guide" | "quiz";
  completed: boolean;
  locked?: boolean;
  body?: string;
  bodyHtml?: string;
  videoUrl?: string;
  transcript?: string;
  resources?: { title: string; url: string; type?: string }[];
  quiz?: LessonQuiz;
};

export type Course = {
  id: string;
  cloudId?: string;
  title: string;
  description: string;
  category: string;
  instructor: string;
  progress: number;
  importedProgress?: number;
  duration: string;
  modules: { title: string; groupTitle?: string; lessons: Lesson[] }[];
  access: "open" | "level" | "purchase";
  requiredLevel?: number;
};

export type AcademyEvent = {
  id: number;
  cloudId?: string;
  title: string;
  description: string;
  date: string;
  time: string;
  duration: string;
  host: string;
  kind: "live" | "workshop" | "office-hours";
  attending: boolean;
  attendeeCount: number;
  meetingUrl?: string;
};

export type Member = {
  id: number;
  cloudId?: string;
  name: string;
  initials: string;
  company: string;
  location: string;
  role: "Owner" | "Admin" | "Moderator" | "Operator";
  level: number;
  points: number;
  following: boolean;
  online?: boolean;
  avatarUrl?: string;
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
  infillRate: number;
  serviceRate: number;
};

export type QuoteTotals = {
  area: number;
  preciseArea: number;
  infillPounds: number;
  bags40: number;
  bags50: number;
  serviceTotal: number;
  total: number;
};
