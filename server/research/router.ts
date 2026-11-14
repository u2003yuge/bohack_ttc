import { Router } from "express";
import { extractResearchItems } from "./extract.js";
import { enrichResume } from "./runner.js";
import { deadline, errorMessage, limit } from "../operations.js";

const router = Router();
for (const operation of ["extract", "enrich"] as const) {
  router.post(`/${operation}`, async (request, response) => {
    const text: unknown = request.body?.text;
    if (typeof text !== "string" || !text.trim() || text.length > 100_000) {
      response.status(400).json({ error: "请提供 1 到 100000 字符的 text（PDF 提取文本或 OCR 结果）。" });
      return;
    }
    if (!process.env.OPENAI_API_KEY) {
      response.status(503).json({ error: "请先配置 OPENAI_API_KEY。" });
      return;
    }
    const scope = deadline(undefined, operation === "extract" ? limit("MODEL_REQUEST_TIMEOUT_MS", 60_000) : limit("RESEARCH_TIMEOUT_MS", 180_000) + 5000, "资料处理超时，请稍后重试。");
    const disconnected = () => { if (!response.writableEnded) scope.abort(new Error("请求已取消。")); };
    response.once("close", disconnected);
    try {
      const result = operation === "extract" ? await extractResearchItems(text, { signal: scope.signal }) : await enrichResume(text, { signal: scope.signal });
      if (!response.destroyed) response.json(result);
    } catch (error) {
      if (!response.destroyed) response.status(502).json({ error: `资料处理失败：${errorMessage(error)}` });
    } finally { response.removeListener("close", disconnected); scope.dispose(); }
  });
}
export default router;
