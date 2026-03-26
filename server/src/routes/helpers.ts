import ExcelJS from "exceljs";
import type { FastifyRequest } from "fastify";

export async function parseWorkbook(file: Awaited<ReturnType<FastifyRequest["file"]>>) {
  if (!file) {
    throw new Error("缺少上传文件");
  }

  const workbook = new ExcelJS.Workbook();
  const buffer = await file.toBuffer();
  await workbook.xlsx.load(buffer as any);
  const sheet = workbook.worksheets[0];
  const rows = sheet.getSheetValues().slice(2) as Array<Array<string | number | undefined>>;
  return rows.map((cells) => cells.slice(1));
}
