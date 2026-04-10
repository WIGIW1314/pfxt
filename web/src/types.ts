export type UserRole = "SUPER_ADMIN" | "ACTIVITY_ADMIN" | "JUDGE" | "SECRETARY";

export type AuthUser = {
  id: string;
  username: string;
  realName: string;
  role: UserRole;
  forceChangePassword: boolean;
  activityRoles?: Array<{
    id: string;
    role: UserRole;
    activityId: string;
    groupId?: string | null;
    activity: {
      id: string;
      name: string;
      code: string;
      isActive?: boolean;
    };
    group?: {
      id: string;
      name: string;
    } | null;
  }>;
};

export type ActivityCustomRole = {
  id: string;
  activityId: string;
  name: string;
  description?: string | null;
  color?: string | null;
  sortOrder: number;
  userRoleCount?: number;
  studentCount?: number;
  userRoles?: Array<{ id: string; userId: string; user?: { id: string; username: string; realName: string } }>;
  students?: Array<{ id: string; name: string; studentNo: string }>;
};

export type Activity = {
  id: string;
  name: string;
  code: string;
  description?: string | null;
  type: string;
  scoreMode: string;
  activeTemplateId?: string | null;
  avgDecimalPlaces: number;
  calcMode: string;
  isActive: boolean;
  isLocked: boolean;
  isPublicVisible: boolean;
  showExportZip: boolean;
  showExportXlsx: boolean;
  showCommentUi: boolean;
  showQuestionUi: boolean;
  allowEditScore: boolean;
  showAvgToJudge: boolean;
  showVoteCountToJudge: boolean;
  startTime?: string | null;
  endTime?: string | null;
  announcement?: string | null;
  announcementFiles?: Array<{ name: string; url: string; type: string; description?: string }>;
  judgeAnnouncement?: string | null;
  judgeAnnouncementFiles?: Array<{ name: string; url: string; type: string; description?: string }>;
  createdAt: string;
  groupCount?: number;
  studentCount?: number;
  judgeCount?: number;
  groups?: Group[];
  students?: Student[];
  activityRoles?: Array<{
    id: string;
    role: UserRole;
    userId: string;
    groupId?: string | null;
    customRoleId?: string | null;
    customRole?: ActivityCustomRole | null;
  }>;
  customRoles?: ActivityCustomRole[];
  templates?: ScoreTemplate[];
};

export type Group = {
  id: string;
  activityId: string;
  name: string;
  sortOrder: number;
  location?: string | null;
  scheduleTime?: string | null;
  isLocked?: boolean;
  startTime?: string | null;
  endTime?: string | null;
  qrcodeUrl?: string | null;
  qrcodeMeta?: string | null; // JSON string storing QrcodeMeta
  note?: string | null;
  studentCount?: number;
  students?: Student[];
  activityRoles?: Array<{
    id: string;
    role: string;
    userId: string;
    customRoleId?: string | null;
    customRole?: ActivityCustomRole | null;
    user: { id: string; username: string; realName: string };
  }>;
};

export type QrcodeMeta = {
  thumb: { url: string; width: number | null; height: number | null };
  medium: { url: string; width: number | null; height: number | null };
  original: { url: string; width: number | null; height: number | null };
};

export type StudentArtwork = {
  id: string;
  url: string;
  uploaderType: "JUDGE" | "ADMIN" | string;
  uploadedById?: string | null;
  createdAt: string;
};

export type Student = {
  id: string;
  activityId: string;
  groupId: string;
  studentNo: string;
  name: string;
  workName?: string | null;
  gender?: string | null;
  className?: string | null;
  majorName?: string | null;
  mentorName?: string | null;
  phone?: string | null;
  orderNo: number;
  customRoleId?: string | null;
  customRole?: ActivityCustomRole | null;
  group?: Group;
  summary?: {
    requiredJudgeCount: number;
    submittedJudgeCount: number;
    avgScore: number | null;
    finalScore: number | null;
    isComplete: boolean;
  };
  peerScores?: Array<{
    id: string;
    anonymousCode?: string;
    totalScore: number;
    status: "DRAFT" | "SUBMITTED";
    comment?: string | null;
    submittedAt?: string | null;
    details?: Array<{
      id?: string;
      itemId: string;
      scoreValue: number;
    }>;
  }>;
  myScoreStatus?: "DRAFT" | "SUBMITTED" | null;
  myVoted?: boolean;
  artworkCount?: number;
  canVote?: boolean;
  artworks?: StudentArtwork[];
  scores?: Score[];
};

export type ScoreTemplate = {
  id: string;
  activityId: string;
  name: string;
  scoreMode: string;
  totalScore: number;
  isDefault: boolean;
  items: ScoreItem[];
};

export type ScoreItem = {
  id: string;
  templateId: string;
  name: string;
  maxScore: number;
  sortOrder: number;
  isRequired: boolean;
  description?: string;
};

export type Score = {
  id: string;
  totalScore: number;
  status: "DRAFT" | "SUBMITTED";
  comment?: string | null;
  details?: Array<{
    id?: string;
    itemId: string;
    scoreValue: number;
  }>;
  judge?: {
    id: string;
    realName: string;
  };
};
