import type { Request, Response } from "express";
import type { AnalysisEvent, AnalysisResult, ResearchBatch } from "../src/research-types.js";
import { deadline, errorMessage, interruptible, limit } from "./operations.js";

type AnalysisOperation = (options: { signal: AbortSignal; emit: (event: AnalysisEvent) => void }) => Promise<AnalysisResult>;

// Both the general agent and saved PDFs use the same progress/cancellation contract.
export async function respondWithAnalysis(request: Request, response: Response, operation: AnalysisOperation) {
  const streamProgress = request.body?.streamProgress === true;
  const scope = deadline(undefined, limit("AGENT_TIMEOUT_MS", 300_000), "分析已达到总时限，请查看已完成资料或缩小问题范围后重试。");
  const disconnected = () => { if (!response.writableEnded) scope.abort(new Error("用户已取消分析或关闭页面。")); };
  response.once("close", disconnected);
  const emit = (event: AnalysisEvent) => {
    if (streamProgress && !response.writableEnded && !response.destroyed) response.write(`${JSON.stringify(event)}\n`);
  };
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  if (streamProgress) {
    response.set({ "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-cache, no-transform", "X-Accel-Buffering": "no" });
    response.flushHeaders();
    heartbeat = setInterval(() => emit({ type: "heartbeat" }), 10_000);
    heartbeat.unref();
    emit({ type: "progress", progress: { stage: "extracting", message: "分析请求已接收，正在处理。" } });
  }
  try {
    const result = await interruptible(operation({ signal: scope.signal, emit }), scope.signal);
    scope.signal.throwIfAborted();
    if (!response.destroyed) {
      if (streamProgress) { emit({ type: "complete", ...result }); response.end(); }
      else response.json(result);
    }
  } catch (error) {
    const message = scope.signal.aborted ? errorMessage(scope.signal.reason) : errorMessage(error);
    scope.abort(error);
    const event: AnalysisEvent = { type: "error", error: `分析未完成：${message}` };
    if (!response.destroyed) {
      if (streamProgress) { emit(event); response.end(); }
      else response.status(502).json(event);
    }
  } finally {
    if (heartbeat) clearInterval(heartbeat);
    response.removeListener("close", disconnected);
    scope.dispose();
  }
}
