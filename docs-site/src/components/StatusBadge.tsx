import React from 'react';
import clsx from 'clsx';

export type StatusType = 'accepted' | 'approved' | 'active' | 'inactive' | 'draft' | 'rejected' | 'proposed' | 'deprecated' | 'superseded' | 'unknown';

interface StatusBadgeProps {
  status: string;
  className?: string;
}

const statusEmojis: Record<string, string> = {
  'accepted': '\u2705',
  'approved': '\u2705',
  'active': '\ud83d\ude80',
  'inactive': '\ud83d\udca4',
  'draft': '\u270f\ufe0f',
  'rejected': '\ud83d\udeab',
  'proposed': '\ud83d\udca1',
  'deprecated': '\ud83d\udce6',
  'superseded': '\u23eb',
  'unknown': '\ud83e\udd37',
};

export default function StatusBadge({status, className}: StatusBadgeProps): React.JSX.Element {
  const normalizedStatus = status.toLowerCase() as StatusType;
  const emoji = statusEmojis[normalizedStatus] || statusEmojis['unknown'];

  return (
    <span className={clsx('status-badge', normalizedStatus, className)}>
      <span className="status-emoji">{emoji}</span> {status}
    </span>
  );
}
