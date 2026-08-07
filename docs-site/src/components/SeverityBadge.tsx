import React from 'react';
import clsx from 'clsx';

export type SeverityType = 'critical' | 'high' | 'medium' | 'low' | 'info' | 'unknown';

interface SeverityBadgeProps {
  severity: string;
  className?: string;
}

const severityEmojis: Record<string, string> = {
  'critical': '\ud83d\udd34',
  'high': '\ud83d\udfe0',
  'medium': '\ud83d\udfe1',
  'low': '\ud83d\udfe2',
  'info': '\ud83d\udd35',
  'unknown': '\u26aa',
};

export default function SeverityBadge({severity, className}: SeverityBadgeProps): React.JSX.Element {
  const normalizedSeverity = severity.toLowerCase() as SeverityType;
  const emoji = severityEmojis[normalizedSeverity] || severityEmojis['unknown'];

  return (
    <span className={clsx('severity-badge', normalizedSeverity, className)}>
      <span className="severity-emoji">{emoji}</span> {severity}
    </span>
  );
}
