import type { TaskItem, SlackMessage, RunAsync } from "../lib/types.ts";
import { timeAgo } from "../lib/formatting.ts";

export async function fetchAirflowFailures(runAsync: RunAsync): Promise<TaskItem[]> {
  const raw = await runAsync(
    `devx agent-tools slack message list commercial-optimization-ops --limit 100 --json ts,user,text,permalink,threadTs`,
    60_000,
  );

  let msgs: SlackMessage[] = [];
  try {
    msgs = JSON.parse(raw.trim() || "[]");
  } catch {
    return [{ id: "parse-error", title: "❌ Failed to parse Slack messages" }];
  }

  const topLevel = msgs.filter((m) => !m.threadTs || m.threadTs === m.ts);
  const items: TaskItem[] = [];
  const seen = new Set<string>();

  for (const msg of topLevel) {
    const text = msg.text || "";

    // Airflow failure messages contain DAG/Task info
    const dagMatch = text.match(/\*DAG\*:\s*<[^|]+\|([^>]+)>/);
    const statusMatch = text.match(/\*Status\*:\s*Failed/i);

    if (!dagMatch || !statusMatch) continue;

    const dagName = dagMatch[1];
    if (seen.has(dagName)) continue;
    seen.add(dagName);

    items.push({
      id: `airflow-${dagName}`,
      title: `✈️ ${dagName}`,
      url: msg.permalink,
      meta: `Airflow failure · ${timeAgo(new Date(parseFloat(msg.ts) * 1000).toISOString())}`,
      priority: "high",
      tags: ["airflow"],
    });
  }

  if (items.length === 0) {
    return [{ id: "all-clear", title: "✅ No Airflow failures", meta: "All clear!" }];
  }

  return items;
}
