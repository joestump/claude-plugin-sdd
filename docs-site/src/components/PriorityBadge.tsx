import React from 'react';
import clsx from 'clsx';

export type PriorityType = 'P0' | 'P1' | 'P2' | 'P3' | 'P4';

interface PriorityBadgeProps {
  priority: string;
  className?: string;
}

const priorityEmojis: Record<string, string> = {
  'P0': '\ud83d\udd34',
  'P1': '\ud83d\udfe0',
  'P2': '\ud83d\udfe1',
  'P3': '\ud83d\udfe2',
  'P4': '\u26aa',
};

export default function PriorityBadge({priority, className}: PriorityBadgeProps): React.JSX.Element {
  const normalizedPriority = priority.toUpperCase() as PriorityType;
  const emoji = priorityEmojis[normalizedPriority] || priorityEmojis['P4'];

  return (
    <span className={clsx('priority-badge', normalizedPriority.toLowerCase(), className)}>
      <span className="priority-emoji">{emoji}</span> {priority}
    </span>
  );
}
