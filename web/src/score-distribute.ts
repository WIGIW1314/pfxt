/**
 * 智能分配总分到各评分项
 * 按各项满分比例分配，加入合理随机波动，确保：
 * 1. 每项不超过满分，不低于 0
 * 2. 各项得分率差异不会太大（控制在 ±10% 以内）
 * 3. 总和精确等于目标总分
 */
export function distributeScore(
  totalScore: number,
  items: Array<{ id: string; maxScore: number }>,
): Record<string, number> {
  if (items.length === 0) return {};

  const maxTotal = items.reduce((s, i) => s + i.maxScore, 0);
  const clamped = Math.max(0, Math.min(totalScore, maxTotal));

  if (items.length === 1) {
    return { [items[0].id]: Math.round(clamped) };
  }

  // 基准得分率
  const baseRate = maxTotal > 0 ? clamped / maxTotal : 0;

  // 为每项生成一个带随机偏移的得分率，偏移范围 ±10%，但确保在 [0, 1] 内
  const jitter = 0.1;
  const rates = items.map(() => {
    const offset = (Math.random() * 2 - 1) * jitter;
    return Math.max(0, Math.min(1, baseRate + offset));
  });

  // 按比例得到初始分数（保留小数）
  const rawScores = items.map((item, i) => rates[i] * item.maxScore);

  // 取整并计算误差
  const rounded = rawScores.map((s) => Math.round(s));

  // 确保不超过各项满分
  items.forEach((item, i) => {
    rounded[i] = Math.max(0, Math.min(item.maxScore, rounded[i]));
  });

  // 修正总分差值
  let diff = clamped - rounded.reduce((s, v) => s + v, 0);
  const step = diff > 0 ? 1 : -1;

  // 按随机顺序调整，每次 ±1，直到差值为 0
  const indices = items.map((_, i) => i).sort(() => Math.random() - 0.5);
  let pass = 0;
  while (diff !== 0 && pass < 1000) {
    for (const i of indices) {
      if (diff === 0) break;
      const next = rounded[i] + step;
      if (next >= 0 && next <= items[i].maxScore) {
        rounded[i] = next;
        diff -= step;
      }
    }
    pass++;
  }

  const result: Record<string, number> = {};
  items.forEach((item, i) => {
    result[item.id] = rounded[i];
  });
  return result;
}
