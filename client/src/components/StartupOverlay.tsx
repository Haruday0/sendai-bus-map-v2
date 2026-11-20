import React from "react";
import {
  Card,
  Chip,
  ProgressBar,
  Separator,
  Spinner,
} from "@heroui/react";
import { CheckCircle2 } from "lucide-react";

export type StartupTaskStatus = "waiting" | "loading" | "done";

export interface StartupTaskItem {
  id: string;
  label: string;
  status: StartupTaskStatus;
}

interface StartupOverlayProps {
  isVisible: boolean;
  progress: number;
  statusText: string;
  serverConnected: boolean;
  isServerWaking: boolean;
  tasks: StartupTaskItem[];
}

const STATUS_BADGE_LABEL: Record<StartupTaskStatus, string> = {
  waiting: "待機中",
  loading: "読み込み中",
  done: "完了",
};

const StartupOverlay: React.FC<StartupOverlayProps> = ({
  isVisible,
  progress,
  statusText,
  serverConnected,
  isServerWaking,
  tasks,
}) => {
  if (!isVisible) return null;

  const serverChipText = serverConnected
    ? "サーバー接続済み"
    : isServerWaking
      ? "サーバー起動中"
      : "サーバー接続中";

  return (
    <div
      className="fixed inset-0 z-[10000] flex h-dvh w-screen items-center justify-center bg-background p-6 text-foreground select-none"
      aria-live="polite"
    >
      <Card
        variant="default"
        className="w-full max-w-[336px] gap-4 rounded-3xl border border-separator bg-surface p-5 shadow-md"
      >
        <div className="flex items-center justify-between gap-2">
          <span className="truncate text-xs font-bold text-foreground">
            {statusText}
          </span>
          <Chip
            size="sm"
            variant="soft"
            color={serverConnected ? "success" : "accent"}
            className="shrink-0 gap-1 px-2 py-0.5 text-[11px]"
          >
            {serverConnected ? (
              <CheckCircle2 className="size-3 shrink-0" aria-hidden />
            ) : (
              <Spinner
                size="sm"
                color="current"
                className="size-3! shrink-0"
                aria-hidden
              />
            )}
            <Chip.Label>{serverChipText}</Chip.Label>
          </Chip>
        </div>

        <ProgressBar
          aria-label={statusText}
          value={progress}
          minValue={0}
          maxValue={100}
          color="accent"
          size="md"
          className="flex w-full items-center gap-2.5"
        >
          <ProgressBar.Track className="h-2 flex-1 rounded-full">
            <ProgressBar.Fill className="rounded-full" />
          </ProgressBar.Track>
          <ProgressBar.Output className="w-8 shrink-0 text-right text-[11px] font-bold text-muted" />
        </ProgressBar>

        <Separator />

        <ul className="m-0 flex list-none flex-col gap-2.5 p-0">
          {tasks.map((task) => (
            <li
              key={task.id}
              className="flex items-center justify-between gap-3 text-xs leading-5"
            >
              <div className="flex min-w-0 items-center gap-2.5">
                <span className="flex size-4 shrink-0 items-center justify-center">
                  {task.status === "done" ? (
                    <CheckCircle2
                      className="size-4 text-success"
                      aria-hidden
                    />
                  ) : task.status === "loading" ? (
                    <Spinner size="sm" color="accent" aria-hidden />
                  ) : (
                    <span
                      className="size-3.5 rounded-full border-2 border-separator"
                      aria-hidden
                    />
                  )}
                </span>
                <span
                  className={`truncate ${
                    task.status === "waiting"
                      ? "text-muted"
                      : "font-medium text-foreground"
                  }`}
                >
                  {task.label}
                </span>
              </div>
              <span
                className={`shrink-0 text-[11px] tabular-nums ${
                  task.status === "done"
                    ? "font-semibold text-success"
                    : task.status === "loading"
                      ? "font-medium text-accent"
                      : "text-muted"
                }`}
              >
                {STATUS_BADGE_LABEL[task.status]}
              </span>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
};

export default StartupOverlay;
