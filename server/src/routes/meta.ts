import type { FastifyInstance } from "fastify";
import { createWorkbookTemplate } from "../utils.js";

export async function registerMetaRoutes(app: FastifyInstance) {
  app.get("/api/meta/templates/students", { preHandler: [app.authenticate] }, async (_request, reply) => {
    const buffer = await createWorkbookTemplate(
      "学生导入模板",
      [
        { header: "学号", key: "studentNo", width: 18 },
        { header: "姓名", key: "name", width: 14 },
        { header: "性别", key: "gender", width: 10 },
        { header: "班级", key: "className", width: 16 },
        { header: "组别", key: "groupName", width: 14 },
        { header: "顺序号", key: "orderNo", width: 10 },
        { header: "活动角色", key: "customRoleName", width: 14 },
      ],
      [
        {
          studentNo: "20270001",
          name: "张三",
          gender: "男",
          className: "教技 1 班",
          groupName: "第一组",
          orderNo: 1,
          customRoleName: "",
        },
      ],
    );

    reply.header("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    reply.header("Content-Disposition", "attachment; filename=students-template.xlsx");
    return reply.send(buffer);
  });

  app.get("/api/meta/templates/judges", { preHandler: [app.authenticate] }, async (_request, reply) => {
    const buffer = await createWorkbookTemplate(
      "评委导入模板",
      [
        { header: "姓名", key: "realName", width: 14 },
        { header: "用户名", key: "username", width: 16 },
        { header: "默认密码", key: "password", width: 14 },
        { header: "组别", key: "groupName", width: 14 },
        { header: "活动角色", key: "customRoleName", width: 14 },
      ],
      [
        {
          realName: "王评委",
          username: "judge01",
          password: "123456",
          groupName: "第一组",
          customRoleName: "主评委",
        },
      ],
    );

    reply.header("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    reply.header("Content-Disposition", "attachment; filename=judges-template.xlsx");
    return reply.send(buffer);
  });

  app.get("/api/meta/templates/groups", { preHandler: [app.authenticate] }, async (_request, reply) => {
    const buffer = await createWorkbookTemplate(
      "分组导入模板",
      [
        { header: "组名", key: "name", width: 14 },
        { header: "排序", key: "sortOrder", width: 10 },
        { header: "地点", key: "location", width: 18 },
        { header: "答辩时间", key: "scheduleTime", width: 22 },
        { header: "备注", key: "note", width: 18 },
      ],
      [
        {
          name: "第一组",
          sortOrder: 1,
          location: "A301",
          scheduleTime: "2026-03-24 09:30:00",
          note: "上午场",
        },
      ],
    );

    reply.header("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    reply.header("Content-Disposition", "attachment; filename=groups-template.xlsx");
    return reply.send(buffer);
  });
}
