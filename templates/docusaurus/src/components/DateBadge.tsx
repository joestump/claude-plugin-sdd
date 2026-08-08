import React from 'react';

interface DateBadgeProps {
  date: string;
  className?: string;
}

const CALENDAR_EMOJI = '\uD83D\uDCC5';

export default function DateBadge({date, className}: DateBadgeProps): React.JSX.Element {
  return (
    <span className={`date-badge ${className || ''}`}>
      {CALENDAR_EMOJI} {date}
    </span>
  );
}
