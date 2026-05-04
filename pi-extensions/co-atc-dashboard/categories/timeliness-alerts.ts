import type { TaskItem, SlackMessage, RunAsync } from "../lib/types.ts";
import { timeAgo, truncate } from "../lib/formatting.ts";

// Root cause tables known to cascade into many downstream tables.
// When these fire, suppress downstream alerts from the same burst window.
const ROOT_CAUSE_PATTERNS = [
  "shop_linked_audio_touchpoints",
  "shop_linked_tv_touchpoints",
  "shop_linked_brochure_pageview_touchpoints",
  "shop_linked_attribution_touchpoints",
  "shop_linked_salesforce_activities_touchpoints",
  "shop_linked_mozart_clicks_touchpoints",
  "marketing_incrementality_factors",
];

interface ParsedAlert {
  status: "firing" | "resolved";
  fqn: string;
  tableName: string;
  violationMinutes: number | null;
  threshold: number | null;
  ts: string;
  permalink: string;
  startedAt: string | null;
}

function parseAlert(msg: SlackMessage): ParsedAlert | null {
  const text = msg.text || "";

  // Must be a DW timeliness alert
  if (!text.includes("Timeliness Violation Alert")) return null;

  const status = text.includes("[FIRING]") ? "firing" : text.includes("[RESOLVED]") ? "resolved" : null;
  if (!status) return null;

  const fqnMatch = text.match(/bigquery:[^\s|>]+/);
  const fqn = fqnMatch?.[0] ?? "";
  const tableName = fqn.split(".").pop() ?? fqn;

  const violationMatch = text.match(/is ([\d,]+) minutes beyond/);
  const violationMinutes = violationMatch ? parseInt(violationMatch[1].replace(/,/g, "")) : null;

  const thresholdMatch = text.match(/timeliness_sli_threshold=([\d]+)/);
  const threshold = thresholdMatch ? parseInt(thresholdMatch[1]) : null;

  return {
    status,
    fqn,
    tableName,
    violationMinutes,
    threshold,
    ts: msg.ts,
    permalink: msg.permalink,
    startedAt: null,
  };
}

function isRootCause(tableName: string): boolean {
  return ROOT_CAUSE_PATTERNS.some((p) => tableName.includes(p));
}

function priorityFromViolation(violationMinutes: number | null, threshold: number | null): "critical" | "high" | "medium" {
  if (!violationMinutes || !threshold) return "medium";
  const ratio = violationMinutes / threshold;
  if (ratio > 100 || violationMinutes > 10_000) return "critical";
  if (ratio > 2) return "high";
  return "medium";
}

export async function fetchTimelinessAlerts(runAsync: RunAsync): Promise<TaskItem[]> {
  const raw = await runAsync(
    `devx agent-tools slack message list commercial-optimization-ops --limit 100 --json ts,user,text,permalink,threadTs`,
    60_000,
  );

  let msgs: SlackMessage[] = [];
  try {
    msgs = JSON.parse(raw.trim() || "[]");
  } catch {
    return [{ id: "parse-error", title: "❌ Failed to parse Slack messages", meta: "Check slack auth" }];
  }

  // Only top-level messages (not thread replies)
  const topLevel = msgs.filter((m) => !m.threadTs || m.threadTs === m.ts);

  const parsed = topLevel.map(parseAlert).filter((a): a is ParsedAlert => a !== null);

  // Group by table name, keep latest status
  const byTable = new Map<string, ParsedAlert[]>();
  for (const alert of parsed) {
    const existing = byTable.get(alert.tableName) ?? [];
    existing.push(alert);
    byTable.set(alert.tableName, existing);
  }

  // Separate root causes from downstream
  const rootCauses: TaskItem[] = [];
  const downstream: TaskItem[] = [];
  const resolved = new Set<string>();

  // First pass: identify resolved tables
  for (const [tableName, alerts] of byTable) {
    const latest = alerts[0]; // msgs are newest-first
    if (latest.status === "resolved") resolved.add(tableName);
  }

  // Second pass: build items
  for (const [tableName, alerts] of byTable) {
    const latest = alerts[0];
    if (latest.status === "resolved") continue; // skip resolved

    const firingCount = alerts.filter((a) => a.status === "firing").length;
    const priority = priorityFromViolation(latest.violationMinutes, latest.threshold);

    const violationStr = latest.violationMinutes
      ? latest.violationMinutes >= 1440
        ? `${Math.round(latest.violationMinutes / 1440)}d late`
        : `${Math.round(latest.violationMinutes / 60)}h late`
      : "late";

    const item: TaskItem = {
      id: `timeliness-${tableName}`,
      title: `🔴 ${tableName}`,
      url: latest.permalink,
      meta: `${violationStr} · ${firingCount > 1 ? `${firingCount} alerts` : "firing"} · ${timeAgo(new Date(parseFloat(latest.ts) * 1000).toISOString())}`,
      priority,
      tags: ["timeliness", isRootCause(tableName) ? "root-cause" : "downstream"],
    };

    if (isRootCause(tableName)) {
      rootCauses.push(item);
    } else {
      downstream.push(item);
    }
  }

  // Sort: root causes first, then by priority, then by violation minutes
  const priorityOrder = { critical: 0, high: 1, medium: 2, low: 3 };
  const sortItems = (a: TaskItem, b: TaskItem) =>
    (priorityOrder[a.priority ?? "medium"] - priorityOrder[b.priority ?? "medium"]);

  rootCauses.sort(sortItems);
  downstream.sort(sortItems);

  const all = [...rootCauses, ...downstream];

  if (all.length === 0) {
    return [{ id: "all-clear", title: "✅ No active timeliness alerts", meta: "All clear!" }];
  }

  return all;
}
