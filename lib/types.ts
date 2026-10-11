export type Person = {
  id: string;
  name: string;
  nickname?: string;
  relationship: string;
  deceased: boolean;
  notes: string[];
  descriptors: number[][];
  refPhotoPaths: string[];
  confirmed: boolean;
  createdAt: string;
};

export type Place = {
  id: string;
  name: string;
  lat: number;
  lng: number;
  radiusM: number;
};

export type FaceBox = { x: number; y: number; width: number; height: number };

export type FaceMatch = {
  personId: string | null;
  box: FaceBox;
  distance: number;
};

/** "archived": a day photo that had no recognised people and wasn't talked about, filed away after its recap day. */
export type PhotoSource = "yesterday" | "album" | "capture" | "archived";

export type Photo = {
  id: string;
  path: string;
  contentType: string;
  source: PhotoSource;
  digitalOrScanned: "digital" | "scanned";
  exif: { takenAt?: string; lat?: number; lng?: number };
  placeLabel?: string;
  placeKind?: "saved" | "town";
  faceMatches: FaceMatch[];
  faces: { descriptor: number[]; box: FaceBox }[];
  note?: string;
  tags: string[];
  uploadedAt: string;
  /** Day (YYYY-MM-DD) whose morning recap tells this photo. Set for photos uploaded as "yesterday". */
  recapDay?: string;
  /** They said something back in a chat about this photo. */
  talkedAbout?: boolean;
  /** Set once a day photo has been moved on after its recap day. */
  movedOnAt?: string;
  movedFrom?: PhotoSource;
};

export type Profile = {
  name?: string;
  gender?: string;
  age?: number;
  livingAlone?: boolean;
  livingDetails?: string;
  regularActivities: string[];
  attentionEvents: string[];
  stage?: "early" | "mid";
};

export type Task = {
  id: string;
  name: string;
  sceneHints: string;
  steps: string[];
  confirmed: boolean;
  createdAt: string;
};

export type ScheduleItem = {
  id: string;
  title: string;
  time: string;
  carerWording?: string;
  confirmed: boolean;
};

export type ReminderPhrase = {
  id: string;
  text: string;
  /** Optional time-of-day fit, e.g. "evening" for "Shall we take a photo of dinner?" */
  slot?: "morning" | "midday" | "afternoon" | "evening" | "any";
  approved: boolean;
  createdAt: string;
};

export type Settings = {
  activeHours: { start: string; end: string };
  remindersEnabled: boolean;
  intervalMin: number;
  jitterMin: number;
  maxPerDay: number;
  fakeClock?: string | null;
  recapLastPlayedDay?: string | null;
};

export type ReminderEvent = {
  id: string;
  text: string;
  firedAt: string;
  day: string;
  status: "pending" | "accepted" | "declined" | "ignored";
};

export type PushToken = { id: string; token: string; createdAt: string };

export type FaceCooldown = { id: string; lastCuedAt: string };

export type LiveTurn = { role: "companion" | "person"; text: string; interrupted?: boolean; flags?: string[] };

/** One Gemini Live chat on the frame. The id is a hash of the one-time ticket, never the ticket itself. */
export type LiveSession = {
  id: string;
  photoId: string;
  opener: string;
  status: "issued" | "active" | "ended";
  createdAt: string;
  expiresAt: string;
  startedAt?: string;
  endedAt?: string;
  endedReason?: string;
  turns: LiveTurn[];
  flagged?: boolean;
};
