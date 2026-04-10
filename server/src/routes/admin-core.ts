// admin-core.ts 已废弃，路由已拆分到以下模块:
// - admin-activities.ts   (活动 CRUD)
// - admin-groups.ts       (分组 CRUD)
// - admin-students.ts     (学生 CRUD)
// - admin-dashboard.ts    (仪表盘)
// - admin-exports.ts      (成绩导出)
// - admin-uploads.ts      (文件上传)
// - admin-logs.ts         (操作日志)
// - admin-custom-roles.ts (自定义角色)
// - admin-users-templates.ts (用户/模板)
//
// 保留本文件作为向后兼容存根，原 registerAdminCoreRoutes 不再注册任何路由。
import type { FastifyInstance } from "fastify";

export function registerAdminCoreRoutes(_app: FastifyInstance) {
  // No routes here — all admin routes are now in their own modules.
}
