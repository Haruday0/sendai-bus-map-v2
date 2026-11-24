import React from "react";

interface TimelineProps {
  children: React.ReactNode;
  color?: string;
  className?: string;
}

/** 縦線が途中で途切れず連続するタイムラインコンテナ */
export const Timeline: React.FC<TimelineProps> = ({
  children,
  color,
  className = "",
}) => (
  <ol
    className={`m-0 flex list-none flex-col p-0 ${className}`}
    style={
      color
        ? ({ "--timeline-color": color } as React.CSSProperties)
        : undefined
    }
  >
    {children}
  </ol>
);

interface TimelineItemProps {
  id?: string;
  leading?: React.ReactNode;
  children: React.ReactNode;
  isPast?: boolean;
  isSkipped?: boolean;
  isCanceled?: boolean;
  isHighlighted?: boolean;
  isFirst?: boolean;
  isLast?: boolean;
  onClick?: (e: React.MouseEvent<HTMLLIElement>) => void;
}

/** 各停車ノード。上下の線を 50% ずつ繋ぐことで行高さが変わっても線が途切れない */
export const TimelineItem: React.FC<TimelineItemProps> = ({
  id,
  leading,
  children,
  isPast = false,
  isSkipped = false,
  isCanceled = false,
  isHighlighted = false,
  isFirst = false,
  isLast = false,
  onClick,
}) => {
  // 通過済み(isPast)・運休(isCanceled)はグレー系、これから向かう(未通過)は路線色（未指定時はアクセント色）。
  // 走行中の区間(直前が通過済み・次が未通過)では、丸と丸の中間までグレー・中間から先が路線色になる。
  const isMutedLine = isPast || isCanceled;
  const lineColorClass = isMutedLine ? "bg-separator" : "";
  const upcomingLineStyle = isMutedLine
    ? undefined
    : { backgroundColor: "var(--timeline-color, var(--accent))" };

  const rowToneClass = isHighlighted
    ? onClick
      ? "bg-warning-soft/80 hover:bg-warning-soft"
      : "bg-warning-soft/80"
    : onClick
      ? isPast
        ? "hover:bg-default/55"
        : "hover:bg-default/75"
      : "";

  // 通過(SKIPPED)・運休・通過済み・未通過でノードの丸印を出し分ける
  const nodeDot = isCanceled ? (
    <span className="relative z-10 size-2.5 rounded-full border-2 border-danger/60 bg-surface" />
  ) : isSkipped ? (
    <span className="relative z-10 size-2.5 rounded-full border-2 border-dashed border-warning bg-surface" />
  ) : isPast ? (
    <span className="relative z-10 size-2.5 rounded-full border-2 border-muted/60 bg-surface" />
  ) : (
    <span
      className="relative z-10 size-2.5 rounded-full border-2 bg-surface"
      style={{ borderColor: "var(--timeline-color, var(--accent))" }}
    />
  );

  return (
    <li
      id={id}
      data-timeline-item="true"
      onClick={onClick}
      className={`relative flex items-stretch gap-2.5 px-4 transition-colors duration-150 ${
        onClick ? "cursor-pointer" : ""
      } ${rowToneClass}`}
    >
      {leading && (
        <div className="flex w-14 shrink-0 items-center justify-center py-1.5 text-center">
          {leading}
        </div>
      )}

      {/* 途切れない縦線 + 停車ノード */}
      <div
        className="relative flex w-5 shrink-0 items-center justify-center self-stretch"
        aria-hidden
      >
        {!isFirst && (
          <span
            className={`absolute top-0 bottom-1/2 left-1/2 w-[3px] -translate-x-1/2 ${lineColorClass}`}
            style={upcomingLineStyle}
          />
        )}
        {!isLast && (
          <span
            className={`absolute top-1/2 bottom-0 left-1/2 w-[3px] -translate-x-1/2 ${lineColorClass}`}
            style={upcomingLineStyle}
          />
        )}
        {nodeDot}
      </div>

      <div className="flex min-w-0 flex-1 flex-col justify-center py-1.5">
        {children}
      </div>
    </li>
  );
};
