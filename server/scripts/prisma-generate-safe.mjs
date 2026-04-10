import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const maxAttempts = 3;
const retryDelayMs = 1200;

const cwd = process.cwd();
const prismaClientCandidates = [
  path.resolve(cwd, "node_modules", ".prisma", "client", "index.js"),
  path.resolve(cwd, "..", "node_modules", ".prisma", "client", "index.js"),
];

function hasGeneratedClient() {
  return prismaClientCandidates.some((candidate) => fs.existsSync(candidate));
}

const prismaBinName = process.platform === "win32" ? "prisma.cmd" : "prisma";
const runnerCandidates = [
  path.resolve(cwd, "node_modules", ".bin", prismaBinName),
  path.resolve(cwd, "..", "node_modules", ".bin", prismaBinName),
  process.platform === "win32" ? "npx.cmd" : "npx",
];

function runPrismaGenerate() {
  for (const candidate of runnerCandidates) {
    const isAbsolute = path.isAbsolute(candidate);
    if (isAbsolute && !fs.existsSync(candidate)) continue;

    const args = isAbsolute ? ["generate"] : ["prisma", "generate"];
    const result = spawnSync(candidate, args, {
      cwd,
      env: process.env,
      encoding: "utf8",
      shell: process.platform === "win32",
    });

    if (result.error && result.error.code === "ENOENT") {
      continue;
    }
    return result;
  }
  return {
    status: 1,
    stdout: "",
    stderr: "Unable to locate prisma CLI binary.\n",
  };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
  const result = runPrismaGenerate();

  const stdout = result.stdout || "";
  const stderr = result.stderr || "";
  if (stdout) process.stdout.write(stdout);
  if (stderr) process.stderr.write(stderr);

  if (result.status === 0) {
    process.exit(0);
  }

  const combinedOutput = `${stdout}\n${stderr}`.toLowerCase();
  const isWindowsLockError = combinedOutput.includes("eperm") || combinedOutput.includes("operation not permitted");
  if (isWindowsLockError && hasGeneratedClient()) {
    console.warn("[WARN] prisma generate 遇到文件锁，但检测到可用 client，继续执行构建。");
    process.exit(0);
  }

  if (attempt < maxAttempts && isWindowsLockError) {
    console.warn(`[WARN] prisma generate 第 ${attempt} 次失败，${retryDelayMs}ms 后重试...`);
    // eslint-disable-next-line no-await-in-loop
    await sleep(retryDelayMs);
    continue;
  }

  process.exit(result.status ?? 1);
}

process.exit(1);
