export type RunAsync = (cmd: string, timeout?: number) => Promise<string>;

export interface TaskItem {
  id: string;
  title: string;
  url?: string;
  meta?: string;
  priority?: "critical" | "high" | "medium" | "low";
  tags?: string[];
  completed?: boolean;
  related?: RelatedMessage[];
}

export interface RelatedMessage {
  ts: string;
  text: string;
  user: string;
  permalink?: string;
}

export interface SlackMessage {
  ts: string;
  user: string;
  text: string;
  permalink: string;
  threadTs?: string;
  replyCount?: number;
}
