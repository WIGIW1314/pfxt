import type { FastifyInstance } from "fastify";
import { registerMetaRoutes } from "./meta.js";
import { registerAdminCoreRoutes } from "./admin-core.js";
import { registerAdminUsersTemplateRoutes } from "./admin-users-templates.js";
import { registerJudgeRoutes } from "./judge.js";
import { registerPublicRoutes } from "./public.js";

export async function registerRoutes(app: FastifyInstance) {
  await registerPublicRoutes(app);
  await registerMetaRoutes(app);
  await registerAdminCoreRoutes(app);
  await registerAdminUsersTemplateRoutes(app);
  await registerJudgeRoutes(app);
}
