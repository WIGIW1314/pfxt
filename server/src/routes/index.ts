import type { FastifyInstance } from "fastify";
import { registerMetaRoutes } from "./meta.js";
import { registerAdminCoreRoutes } from "./admin-core.js";
import { registerAdminActivityRoutes } from "./admin-activities.js";
import { registerAdminGroupRoutes } from "./admin-groups.js";
import { registerAdminStudentRoutes } from "./admin-students.js";
import { registerAdminDashboardRoutes } from "./admin-dashboard.js";
import { registerAdminExportRoutes } from "./admin-exports.js";
import { registerAdminUploadRoutes } from "./admin-uploads.js";
import { registerAdminLogsRoutes } from "./admin-logs.js";
import { registerAdminCustomRoleRoutes } from "./admin-custom-roles.js";
import { registerAdminUsersTemplateRoutes } from "./admin-users-templates.js";
import { registerJudgeRoutes } from "./judge.js";
import { registerPublicRoutes } from "./public.js";
import { registerMetricsRoutes } from "./metrics.js";

export async function registerRoutes(app: FastifyInstance) {
  await registerPublicRoutes(app);
  await registerMetaRoutes(app);
  await registerMetricsRoutes(app);
  await registerAdminCoreRoutes(app);
  await registerAdminActivityRoutes(app);
  await registerAdminGroupRoutes(app);
  await registerAdminStudentRoutes(app);
  await registerAdminDashboardRoutes(app);
  await registerAdminExportRoutes(app);
  await registerAdminUploadRoutes(app);
  await registerAdminLogsRoutes(app);
  await registerAdminCustomRoleRoutes(app);
  await registerAdminUsersTemplateRoutes(app);
  await registerJudgeRoutes(app);
}
