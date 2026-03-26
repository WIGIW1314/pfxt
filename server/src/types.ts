import type { FastifyRequest } from "fastify";
import type { UserRole } from "@prisma/client";

export type AuthPayload = {
  userId: string;
  username: string;
  role: UserRole;
};

export type AuthRequest = FastifyRequest & {
  user: AuthPayload;
};

export type ScoreSummary = {
  requiredJudgeCount: number;
  submittedJudgeCount: number;
  avgScore: number | null;
  finalScore: number | null;
  isComplete: boolean;
};
