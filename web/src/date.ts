import dayjs from "dayjs";
import utc from "dayjs/plugin/utc";
import timezone from "dayjs/plugin/timezone";

dayjs.extend(utc);
dayjs.extend(timezone);
dayjs.tz.setDefault("Asia/Shanghai");

/** 将任意时间值格式化为北京时间字符串 */
export function formatBJ(value: string | Date | null | undefined, fmt = "YYYY/MM/DD HH:mm:ss"): string {
  if (!value) return "";
  return dayjs(value).tz("Asia/Shanghai").format(fmt);
}

export { dayjs };
