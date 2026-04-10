import type { FastifyInstance } from "fastify";

/**
 * POST /api/metrics/web-vitals
 * Receives Core Web Vitals data from the frontend.
 * Self-hosted — no external services needed.
 */
export async function registerMetricsRoutes(app: FastifyInstance) {
  app.post("/api/metrics/web-vitals", async (request, reply) => {
    const body = request.body as Record<string, any> | undefined;
    if (!body) {
      return reply.code(400).send({ message: "Empty body" });
    }

    // Structured log for monitoring
    const { lcp, fid, cls, ttfb, fcp, ratings, url } = body;
    const parts: string[] = [];

    if (lcp != null) parts.push(`LCP=${lcp}ms${ratings?.lcp ? `(${ratings.lcp})` : ""}`);
    if (fcp != null) parts.push(`FCP=${fcp}ms${ratings?.fcp ? `(${ratings.fcp})` : ""}`);
    if (fid != null) parts.push(`FID=${fid}ms`);
    if (cls != null) parts.push(`CLS=${cls}${ratings?.cls ? `(${ratings.cls})` : ""}`);
    if (ttfb != null) parts.push(`TTFB=${ttfb}ms${ratings?.ttfb ? `(${ratings.ttfb})` : ""}`);

    const level = getVitalsLevel(ratings);
    console.log(`[METRICS] ${level} ${parts.join(" ")} url=${url || "-"}`);

    return { ok: true };
  });
}

function getVitalsLevel(ratings?: Record<string, string>): string {
  if (!ratings) return "INF";
  const values = Object.values(ratings).filter(Boolean);
  if (values.includes("poor")) return "WRN";
  if (values.includes("needs-improvement")) return "INF";
  return "INF";
}
