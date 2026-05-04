import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { fetchTimelinessAlerts } from "./categories/timeliness-alerts.ts";
import { fetchAirflowFailures } from "./categories/airflow-failures.ts";
import type { TaskItem } from "./lib/types.ts";

const PRIORITY_ORDER = { critical: 0, high: 1, medium: 2, low: 3, undefined: 4 };

function renderItem(item: TaskItem, idx: number, selected: boolean): string {
  const priorityIcon =
    item.priority === "critical" ? "🔴" :
    item.priority === "high" ? "🟠" :
    item.priority === "medium" ? "🟡" : "⚪";

  const rootCause = item.tags?.includes("root-cause") ? " [ROOT CAUSE]" : "";
  const title = `${idx + 1}. ${priorityIcon}${rootCause} ${item.title.replace(/^🔴\s*/, "")}`;
  const meta = item.meta ? `   ${item.meta}` : "";

  if (selected) {
    return `\x1b[44m${title}\x1b[0m\n\x1b[2m${meta}\x1b[22m`;
  }
  return `${title}\n\x1b[2m${meta}\x1b[22m`;
}

export default function coAtcDashboard(pi: ExtensionAPI): void {
  pi.registerCommand("atc", {
    description: "Open the Commercial Optimization ATC dashboard",
    handler: async (_args, ctx) => {
      ctx.ui.notify("Loading #commercial-optimization-ops alerts...", "info");

      const runAsync = async (cmd: string): Promise<string> => {
        const result = await ctx.sandbox.exec(cmd);
        return result.stdout;
      };

      // Fetch both alert types in parallel
      const [timeliness, airflow] = await Promise.all([
        fetchTimelinessAlerts(runAsync),
        fetchAirflowFailures(runAsync),
      ]);

      const firingTimeliness = timeliness.filter((i) => i.id !== "all-clear");
      const firingAirflow = airflow.filter((i) => i.id !== "all-clear");

      const rootCauses = firingTimeliness.filter((i) => i.tags?.includes("root-cause"));
      const downstream = firingTimeliness.filter((i) => i.tags?.includes("downstream"));

      // Build summary for the agent
      const lines: string[] = [
        "# ✈️ Commercial Optimization ATC Dashboard",
        `**Channel:** #commercial-optimization-ops`,
        "",
      ];

      if (firingAirflow.length > 0) {
        lines.push(`## ✈️ Airflow Failures (${firingAirflow.length})`);
        for (const item of firingAirflow) {
          lines.push(`- ${item.title} — ${item.meta}`);
          if (item.url) lines.push(`  ${item.url}`);
        }
        lines.push("");
      }

      if (rootCauses.length > 0) {
        lines.push(`## 🔴 Root Cause Timeliness Alerts (${rootCauses.length})`);
        lines.push("_These tables cascade into many downstream alerts. Fix these first._");
        lines.push("");
        for (const item of rootCauses) {
          lines.push(`- **${item.title.replace(/^🔴\s*/, "")}** — ${item.meta}`);
          if (item.url) lines.push(`  ${item.url}`);
        }
        lines.push("");
      }

      if (downstream.length > 0) {
        lines.push(`## 🟠 Downstream Timeliness Alerts (${downstream.length})`);
        lines.push("_Likely cascading from root causes above. May resolve automatically._");
        lines.push("");
        for (const item of downstream.slice(0, 10)) {
          lines.push(`- ${item.title.replace(/^🔴\s*/, "")} — ${item.meta}`);
        }
        if (downstream.length > 10) {
          lines.push(`_...and ${downstream.length - 10} more_`);
        }
        lines.push("");
      }

      if (firingTimeliness.length === 0 && firingAirflow.length === 0) {
        lines.push("## ✅ All Clear!");
        lines.push("No active alerts in #commercial-optimization-ops.");
      } else {
        lines.push("---");
        lines.push(`**Summary:** ${rootCauses.length} root causes, ${downstream.length} downstream, ${firingAirflow.length} Airflow failures`);
        lines.push("");
        lines.push("Ask me to investigate any specific table or suggest next steps.");
      }

      pi.sendMessage(
        {
          customType: "atc-dashboard",
          content: lines.join("\n"),
          display: true,
        },
        { triggerTurn: true },
      );
    },
  });
}
