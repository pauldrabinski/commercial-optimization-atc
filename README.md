# Commercial Optimization ATC Dashboard

A pi extension for the Commercial Optimization Data team that surfaces and prioritizes timeliness alerts from `#commercial-optimization-ops`.

## What it does

Run `/atc` in pi to get a prioritized view of:

- **Root cause timeliness alerts** — tables at the top of the lineage tree that cascade into many downstream alerts (fix these first)
- **Downstream timeliness alerts** — likely cascading from root causes, may resolve automatically
- **Airflow failures** — DAG failures in the channel

The extension understands the `shop_linked_*_touchpoints` tables as known root causes and surfaces them prominently.

## Installation

```bash
pi install git:github.com/pauldrabinski/commercial-optimization-atc
```

Then `/atc` in any pi session opens the dashboard.

## Usage

```
/atc
```

Pi will load recent messages from `#commercial-optimization-ops`, parse and group them, and give you a prioritized summary you can then ask it to investigate further.

Example follow-up prompts:
- "Investigate the shop_linked_audio_touchpoints_v1 failure"
- "What's the lineage downstream of marketing_incrementality_factors_v1?"
- "Which of these can I ignore and which need action today?"

## Status

This is an early demo. Planned improvements:
- TUI mode (keyboard navigation like privacy-eng ATC)
- Snooze/acknowledge alerts
- Auto-diagnosis using lineage + freshness history
- Slack emoji reactions to mark alerts as seen
