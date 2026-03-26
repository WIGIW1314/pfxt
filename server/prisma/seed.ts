import bcrypt from "bcryptjs";
import { ActivityCalcMode, UserRole } from "@prisma/client";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function ensureSchema() {
  const ddl = `
  PRAGMA foreign_keys = OFF;
  DROP TABLE IF EXISTS "ScoreDetail";
  DROP TABLE IF EXISTS "Score";
  DROP TABLE IF EXISTS "ScoreAssignment";
  DROP TABLE IF EXISTS "ScoreItem";
  DROP TABLE IF EXISTS "ScoreTemplate";
  DROP TABLE IF EXISTS "Student";
  DROP TABLE IF EXISTS "ActivityUserRole";
  DROP TABLE IF EXISTS "Group";
  DROP TABLE IF EXISTS "Activity";
  DROP TABLE IF EXISTS "OperationLog";
  DROP TABLE IF EXISTS "User";

  CREATE TABLE "User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "username" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "realName" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "phone" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "forceChangePassword" BOOLEAN NOT NULL DEFAULT true,
    "lastLoginAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
  );
  CREATE UNIQUE INDEX "User_username_key" ON "User"("username");

  CREATE TABLE "Activity" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "description" TEXT,
    "type" TEXT NOT NULL,
    "scoreMode" TEXT NOT NULL,
    "activeTemplateId" TEXT,
    "avgDecimalPlaces" INTEGER NOT NULL DEFAULT 2,
    "calcMode" TEXT NOT NULL DEFAULT 'SIMPLE_AVG',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "isLocked" BOOLEAN NOT NULL DEFAULT false,
    "allowEditScore" BOOLEAN NOT NULL DEFAULT true,
    "showAvgToJudge" BOOLEAN NOT NULL DEFAULT false,
    "showPeerScoresToJudge" BOOLEAN NOT NULL DEFAULT false,
    "showGroupProgressToSecretary" BOOLEAN NOT NULL DEFAULT true,
    "startTime" DATETIME,
    "endTime" DATETIME,
    "createdBy" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Activity_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
  );
  CREATE UNIQUE INDEX "Activity_code_key" ON "Activity"("code");

  CREATE TABLE "Group" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "activityId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "location" TEXT,
    "scheduleTime" DATETIME,
    "note" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Group_activityId_fkey" FOREIGN KEY ("activityId") REFERENCES "Activity" ("id") ON DELETE CASCADE ON UPDATE CASCADE
  );
  CREATE UNIQUE INDEX "Group_activityId_name_key" ON "Group"("activityId","name");

  CREATE TABLE "ActivityUserRole" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "activityId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "groupId" TEXT,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ActivityUserRole_activityId_fkey" FOREIGN KEY ("activityId") REFERENCES "Activity" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ActivityUserRole_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ActivityUserRole_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "Group" ("id") ON DELETE SET NULL ON UPDATE CASCADE
  );
  CREATE INDEX "ActivityUserRole_activityId_userId_idx" ON "ActivityUserRole"("activityId","userId");

  CREATE TABLE "Student" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "activityId" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "studentNo" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "gender" TEXT,
    "className" TEXT,
    "majorName" TEXT,
    "mentorName" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "orderNo" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Student_activityId_fkey" FOREIGN KEY ("activityId") REFERENCES "Activity" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Student_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "Group" ("id") ON DELETE CASCADE ON UPDATE CASCADE
  );
  CREATE UNIQUE INDEX "Student_activityId_studentNo_key" ON "Student"("activityId","studentNo");

  CREATE TABLE "ScoreTemplate" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "activityId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "scoreMode" TEXT NOT NULL,
    "totalScore" REAL NOT NULL DEFAULT 100,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ScoreTemplate_activityId_fkey" FOREIGN KEY ("activityId") REFERENCES "Activity" ("id") ON DELETE CASCADE ON UPDATE CASCADE
  );

  CREATE TABLE "ScoreItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "templateId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "maxScore" REAL NOT NULL,
    "weight" REAL NOT NULL DEFAULT 1,
    "isRequired" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "description" TEXT,
    CONSTRAINT "ScoreItem_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "ScoreTemplate" ("id") ON DELETE CASCADE ON UPDATE CASCADE
  );

  CREATE TABLE "ScoreAssignment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "activityId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "judgeUserId" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "isRequired" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ScoreAssignment_activityId_fkey" FOREIGN KEY ("activityId") REFERENCES "Activity" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ScoreAssignment_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ScoreAssignment_judgeUserId_fkey" FOREIGN KEY ("judgeUserId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ScoreAssignment_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "Group" ("id") ON DELETE CASCADE ON UPDATE CASCADE
  );
  CREATE UNIQUE INDEX "ScoreAssignment_activityId_studentId_judgeUserId_key" ON "ScoreAssignment"("activityId","studentId","judgeUserId");

  CREATE TABLE "Score" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "activityId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "judgeUserId" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "totalScore" REAL NOT NULL,
    "status" TEXT NOT NULL,
    "comment" TEXT,
    "submittedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Score_activityId_fkey" FOREIGN KEY ("activityId") REFERENCES "Activity" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Score_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Score_judgeUserId_fkey" FOREIGN KEY ("judgeUserId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Score_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "Group" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Score_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "ScoreTemplate" ("id") ON DELETE CASCADE ON UPDATE CASCADE
  );
  CREATE UNIQUE INDEX "Score_activityId_studentId_judgeUserId_key" ON "Score"("activityId","studentId","judgeUserId");

  CREATE TABLE "ScoreDetail" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "scoreId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "scoreValue" REAL NOT NULL,
    CONSTRAINT "ScoreDetail_scoreId_fkey" FOREIGN KEY ("scoreId") REFERENCES "Score" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ScoreDetail_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "ScoreItem" ("id") ON DELETE CASCADE ON UPDATE CASCADE
  );

  CREATE TABLE "OperationLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "operatorId" TEXT,
    "operatorName" TEXT NOT NULL,
    "module" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "targetType" TEXT NOT NULL,
    "targetId" TEXT,
    "beforeData" TEXT,
    "afterData" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "OperationLog_operatorId_fkey" FOREIGN KEY ("operatorId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
  );
  PRAGMA foreign_keys = ON;
  `;

  const statements = ddl
    .split(";")
    .map((statement) => statement.trim())
    .filter(Boolean);

  for (const statement of statements) {
    await prisma.$executeRawUnsafe(`${statement};`);
  }
}

async function main() {
  await ensureSchema();

  const passwordHash = await bcrypt.hash("123456", 10);

  const [admin, judge1, judge2, secretary] = await Promise.all([
    prisma.user.create({
      data: {
        username: "admin",
        realName: "系统管理员",
        passwordHash,
        role: UserRole.ACTIVITY_ADMIN,
        forceChangePassword: false,
      },
    }),
    prisma.user.create({
      data: {
        username: "judge01",
        realName: "王评委",
        passwordHash,
        role: UserRole.JUDGE,
        forceChangePassword: false,
      },
    }),
    prisma.user.create({
      data: {
        username: "judge02",
        realName: "李评委",
        passwordHash,
        role: UserRole.JUDGE,
        forceChangePassword: false,
      },
    }),
    prisma.user.create({
      data: {
        username: "secretary01",
        realName: "周秘书",
        passwordHash,
        role: UserRole.SECRETARY,
        forceChangePassword: false,
      },
    }),
  ]);

  const activity = await prisma.activity.create({
    data: {
      name: "2027 届微格教学评分",
      code: "MICRO-2027",
      description: "移动优先通用评分演示活动",
      type: "微格教学",
      scoreMode: "ITEMIZED",
      avgDecimalPlaces: 2,
      calcMode: ActivityCalcMode.SIMPLE_AVG,
      createdBy: admin.id,
      showAvgToJudge: true,
    },
  });

  const [groupA, groupB] = await Promise.all([
    prisma.group.create({
      data: {
        activityId: activity.id,
        name: "第一组",
        sortOrder: 1,
        location: "A301",
        note: "上午场",
      },
    }),
    prisma.group.create({
      data: {
        activityId: activity.id,
        name: "第二组",
        sortOrder: 2,
        location: "A302",
        note: "下午场",
      },
    }),
  ]);

  await prisma.activityUserRole.createMany({
    data: [
      { activityId: activity.id, userId: admin.id, role: UserRole.ACTIVITY_ADMIN, isPrimary: true },
      { activityId: activity.id, userId: judge1.id, role: UserRole.JUDGE, groupId: groupA.id, isPrimary: true },
      { activityId: activity.id, userId: judge2.id, role: UserRole.JUDGE, groupId: groupA.id, isPrimary: true },
      { activityId: activity.id, userId: secretary.id, role: UserRole.SECRETARY, groupId: groupA.id, isPrimary: true },
    ],
  });

  const template = await prisma.scoreTemplate.create({
    data: {
      activityId: activity.id,
      name: "微格教学标准模板",
      scoreMode: "ITEMIZED",
      totalScore: 100,
      isDefault: true,
      items: {
        create: [
          { name: "教学设计", maxScore: 30, weight: 0.3, sortOrder: 1 },
          { name: "课堂表达", maxScore: 25, weight: 0.25, sortOrder: 2 },
          { name: "教学方法", maxScore: 20, weight: 0.2, sortOrder: 3 },
          { name: "互动效果", maxScore: 15, weight: 0.15, sortOrder: 4 },
          { name: "教态仪表", maxScore: 10, weight: 0.1, sortOrder: 5 },
        ],
      },
    },
    include: { items: true },
  });

  await prisma.activity.update({
    where: { id: activity.id },
    data: {
      activeTemplateId: template.id,
    },
  });

  const students = await Promise.all(
    [
      ["20270001", "张三", "教技 1 班", 1],
      ["20270002", "李四", "教技 1 班", 2],
      ["20270003", "王五", "教技 2 班", 3],
      ["20270004", "赵六", "教技 2 班", 4],
    ].map(([studentNo, name, className, orderNo]) =>
      prisma.student.create({
        data: {
          activityId: activity.id,
          groupId: groupA.id,
          studentNo: String(studentNo),
          name: String(name),
          className: String(className),
          majorName: "教育技术",
          mentorName: "陈老师",
          orderNo: Number(orderNo),
        },
      }),
    ),
  );

  for (const student of students) {
    await prisma.scoreAssignment.createMany({
      data: [
        { activityId: activity.id, studentId: student.id, judgeUserId: judge1.id, groupId: groupA.id },
        { activityId: activity.id, studentId: student.id, judgeUserId: judge2.id, groupId: groupA.id },
      ],
    });
  }

  const firstStudent = students[0];
  await prisma.score.create({
    data: {
      activityId: activity.id,
      studentId: firstStudent.id,
      judgeUserId: judge1.id,
      groupId: groupA.id,
      templateId: template.id,
      totalScore: 89,
      status: "SUBMITTED",
      submittedAt: new Date(),
      comment: "课堂组织较好",
      details: {
        create: template.items.map((item, index) => ({
          itemId: item.id,
          scoreValue: [27, 22, 18, 13, 9][index],
        })),
      },
    },
  });

  await prisma.group.create({
    data: {
      activityId: activity.id,
      name: "第三组",
      sortOrder: 3,
      location: "A303",
      note: "预备组",
    },
  });

  await prisma.student.create({
    data: {
      activityId: activity.id,
      groupId: groupB.id,
      studentNo: "20270005",
      name: "孙七",
      className: "教技 3 班",
      majorName: "教育技术",
      mentorName: "刘老师",
      orderNo: 1,
    },
  });
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
