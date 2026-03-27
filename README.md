# 线上评分系统 / Online Scoring System

一个面向教学评价、微格教学、面试评分等场景的线上评分系统，支持管理员、评委和公开展示三类使用角色。  
An online scoring system for teaching evaluation, microteaching, interview assessment, and similar scenarios, with dedicated experiences for administrators, judges, and public viewers.

## 项目简介 / Overview

本项目提供从活动配置、分组管理、评委分配、现场评分，到结果汇总与导出的完整流程。系统支持实时在线状态、模板化评分、公开信息展示，以及多种文档导出能力。  
This project covers the full workflow from activity setup, group management, judge assignment, and live scoring to result aggregation and export. It includes real-time online presence, template-based scoring, public information pages, and multiple export formats.

## 核心功能 / Features

- 活动管理：切换当前活动，维护活动配置与评分模板。  
  Activity management: switch the active event and maintain event settings and scoring templates.
- 分组、学生、评委、角色管理：支持增删改查、导入与批量操作。  
  Group, student, judge, and role management: supports CRUD, import, and batch operations.
- 评委评分：支持总分模式与分项评分模式，适合现场评分与表格式评分。  
  Judge scoring: supports both total-score mode and itemized scoring mode for live and form-based evaluation.
- 结果汇总：展示评分进度、平均分、最终分和按活动角色统计的在线状态。  
  Result summary: shows scoring progress, average score, final score, and online presence grouped by active activity roles.
- 实时同步：基于 WebSocket 推送在线连接与状态变化。  
  Real-time sync: uses WebSocket to push online presence and status changes.
- 文档导出：支持 Excel、Word、PDF 以及压缩包导出。  
  Export: supports Excel, Word, PDF, and ZIP exports.
- 公共展示页：支持分组信息、评分标准、角色职责、活动公告等公开内容。  
  Public pages: supports public access to group info, scoring standards, role responsibilities, announcements, and more.

## 技术栈 / Tech Stack

### 前端 / Frontend

- Vue 3
- Vite
- TypeScript
- Element Plus
- Pinia
- Vue Router
- Tiptap

### 后端 / Backend

- Fastify
- Prisma
- SQLite
- WebSocket
- JWT Authentication
- ExcelJS / docx / pdfkit / jszip

## 项目结构 / Project Structure

```text
pfxt/
├─ web/                    # Vue 3 前端 / Vue 3 frontend
├─ server/                 # Fastify + Prisma 后端 / backend
├─ deploy.sh               # 服务器部署脚本 / deployment script
├─ ecosystem.config.cjs    # PM2 配置 / PM2 config
└─ package.json            # npm workspaces 根配置 / workspace root
```

## 本地开发 / Local Development

### 1. 安装依赖 / Install dependencies

```bash
npm install
```

### 2. 配置后端环境变量 / Configure backend environment

在 `server/.env` 中至少配置以下内容：  
Configure at least the following values in `server/.env`:

```env
DATABASE_URL="file:./prisma/dev.db"
JWT_SECRET="replace-with-a-random-string-longer-than-32-characters"
CORS_ORIGIN="http://localhost:5173,http://localhost:5174"
PORT=3100
AI_API_URL="http://127.0.0.1:11434/api/chat"
AI_MODEL="gpt-oss:20b"
# 仅在模型/服务支持时再配置；不支持就留空或删除
AI_THINK="low"
```

说明 / Notes:

- `AI_API_URL` 默认按本地 Ollama 使用。若地址是 `/api/chat`，后端会按聊天格式发送 `messages`；否则按传统 `prompt` 方式发送。  
  `AI_API_URL` is designed for local Ollama by default. If the URL points to `/api/chat`, the backend sends chat-style `messages`; otherwise it falls back to a classic `prompt` payload.

- `AI_THINK` 是可选项。只有配置了该环境变量时，后端才会把 `think` 字段一并传给模型。  
  `AI_THINK` is optional. The backend includes the `think` field only when this env var is configured.
- 兼容旧变量名 `OLLAMA_API_URL`、`OLLAMA_MODEL`、`OLLAMA_THINK`，但建议后续统一使用 `AI_*`。  
  Legacy env names `OLLAMA_API_URL`, `OLLAMA_MODEL`, and `OLLAMA_THINK` are still supported, but `AI_*` is recommended going forward.

### 3. 启动开发环境 / Start development

后端 / Backend:

```bash
npm run dev:server
```

前端 / Frontend:

```bash
npm run dev:web
```

## 构建与运行 / Build and Run

```bash
npm run build
npm run start:server
```

前端构建产物位于 `web/dist`，后端运行入口为 `server/dist/src/index.js`。  
The frontend build output is generated in `web/dist`, and the backend entry point is `server/dist/src/index.js`.

## 生产部署 / Production Deployment

推荐使用以下结构：  
Recommended layout:

- 代码仓库 / Code repository: `/www/wwwroot/pfxt-git`
- 私有资源目录 / Private assets directory: `/www/wwwroot/pfxt-private`

私有目录建议存放：  
Recommended private assets:

- `dev.db`
- `logo.svg`
- `签名/`
- `微格教学技能评价表.docx`

部署流程 / Deployment flow:

```bash
cd /www/wwwroot/pfxt-git
bash ./deploy.sh
```

当前项目默认通过 PM2 运行后端。更多部署细节请查看：  
The backend is intended to run with PM2 in production. For deployment details, see:

- [部署教程-服务器拉代码构建.md](/e:/pfxt/部署教程-服务器拉代码构建.md)

## 隐私与安全 / Privacy and Security

以下文件不应提交到 Git 仓库：  
The following files should not be committed to Git:

- `server/.env`
- 数据库文件 / database files
- 上传文件 / uploaded files
- 签名图片 / signature images
- Word 模板等私有资源 / private templates such as Word documents
- 私有 logo / private logo assets

本项目已经将这些内容纳入忽略规则，并支持从仓库外目录读取私有资源。  
These files are already ignored in Git, and the application supports loading private assets from outside the repository.

## 适用场景 / Use Cases

- 微格教学评分 / Microteaching evaluation
- 教学技能比赛评分 / Teaching skills competition scoring
- 面试与试讲评分 / Interview and trial lecture scoring
- 多评委现场打分 / Multi-judge live scoring

## License

当前仓库未单独声明开源许可证。若需公开发布，建议补充明确的 License 文件。  
This repository does not currently include a dedicated open-source license. Add a proper `LICENSE` file if you plan to distribute it publicly.
