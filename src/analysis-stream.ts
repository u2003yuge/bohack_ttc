import type { AnalysisEvent } from "./research-types.js";

export async function readAnalysisEvents(response: Response, onEvent: (event: AnalysisEvent) => void) {
  if (!response.body) throw new Error("浏览器无法读取分析进度。");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let finished = false;
  const consume = (line: string) => {
    if (!line.trim()) return;
    const event = JSON.parse(line) as AnalysisEvent;
    onEvent(event);
    if (event.type === "error") throw new Error(event.error);
    if (event.type === "complete") finished = true;
  };
  try {
    while (!finished) {
      const { value, done } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      let boundary: number;
      while ((boundary = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 1);
        consume(line);
        if (finished) break;
      }
      if (buffer.length > 2_000_000) throw new Error("分析响应过大，请缩小问题范围后重试。");
      if (done) {
        if (!finished && buffer.trim()) consume(buffer);
        if (!finished) throw new Error("分析连接提前结束，已收到的资料仍可查看，请重试。");
        break;
      }
    }
  } catch (error) {
    await reader.cancel().catch(() => {});
    throw error;
  } finally { reader.releaseLock(); }
}
