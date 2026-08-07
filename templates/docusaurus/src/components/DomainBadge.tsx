import React from 'react';
import clsx from 'clsx';

interface DomainBadgeProps {
  domain: string;
  className?: string;
}

const DOMAIN_EMOJI = '\uD83D\uDCE6';

export default function DomainBadge({domain, className}: DomainBadgeProps): React.JSX.Element {
  return (
    <span className={clsx('domain-badge', className)}>
      {DOMAIN_EMOJI} {domain}
    </span>
  );
}
