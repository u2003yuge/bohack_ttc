import { Router } from "express";
import { errorMessage } from "../operations.js";
import { resumeAgentCatalog, resumeAnalysisAgentIds, runResumeAgents, type AgentArtifact, type ResumeAgentId } from "./registry.js";

const router = Router();

router.get("/catalog", (_request, response) => response.json({ agents: resumeAgentCatalog }));

router.post("/run", async (request, response) => {
  const body = request.body ?? {};
  const resumeText = typeof body.resumeText === "string" ? body.resumeText : "";
  const fileName = typeof body.fileName === "string" ? body.fileName.slice(0, 300) : "未命名简历";
  const requested = Array.isArray(body.agents) ? body.agents : [];
  if (!requested.length || requested.some((id: unknown) => typeof id !== "string" || !resumeAnalysisAgentIds.includes(id as typeof resumeAnalysisAgentIds[number]))) {
    response.status(400).json({ error: "请提供有效的分析 Agent 功能列表。", available: resumeAnalysisAgentIds });
    return;
  }
  if (typeof body.force !== "undefined" && typeof body.force !== "boolean") {
    response.status(400).json({ error: "force 必须为布尔值。" });
    return;
  }
  if (typeof body.useModel !== "undefined" && typeof body.useModel !== "boolean") {
    response.status(400).json({ error: "useModel 必须为布尔值。" });
    return;
  }
  if (typeof body.includeResearch !== "undefined" && typeof body.includeResearch !== "boolean") {
    response.status(400).json({ error: "includeResearch 必须为布尔值。" });
    return;
  }
  const artifacts: AgentArtifact[] = Array.isArray(body.artifacts)
    ? body.artifacts.filter((item: unknown): item is AgentArtifact => {
        if (!item || typeof item !== "object") return false;
        const artifact = item as Record<string, unknown>;
        return typeof artifact.id === "string"
          && resumeAgentIds.includes(artifact.id as ResumeAgentId)
          && typeof artifact.inputHash === "string"
          && Object.hasOwn(artifact, "output");
      })
    : [];
  const controller = new AbortController();
  const cancel = () => controller.abort(new Error("请求已取消。"));
  request.once("aborted", cancel);
  response.once("close", cancel);
  try {
    const result = await runResumeAgents({
      context: {
        resumeText,
        fileName,
        roleRequirements: typeof body.roleRequirements === "string" ? body.roleRequirements.slice(0, 12_000) : "",
        question: typeof body.question === "string" ? body.question.slice(0, 2_000) : "",
        reviewerFocus: typeof body.reviewerFocus === "string" ? body.reviewerFocus.slice(0, 500) : "",
        useModel: body.useModel !== false,
        includeResearch: false,
      },
      requested: requested as typeof resumeAnalysisAgentIds[number][],
      artifacts,
      force: body.force === true,
      signal: controller.signal,
    });
    if (!response.destroyed) response.json(result);
  } catch (error) {
    if (!response.destroyed) response.status(400).json({ error: errorMessage(error) });
  } finally {
    request.removeListener("aborted", cancel);
    response.removeListener("close", cancel);
  }
});

export default router;
