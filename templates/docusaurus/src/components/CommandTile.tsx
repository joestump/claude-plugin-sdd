import React, {ReactElement} from 'react';
import Link from '@docusaurus/Link';
import clsx from 'clsx';

interface CommandTileProps {
  name: string;
  description?: string;
  argumentHint?: string;
  href: string;
  className?: string;
}

export default function CommandTile({
  name,
  description,
  argumentHint,
  href,
  className,
}: CommandTileProps): ReactElement {
  const command = `/sdd:${name}${argumentHint ? ' ' + argumentHint : ''}`;
  return (
    <Link to={href} className={clsx('command-tile', className)}>
      <div className="command-tile__header">
        <span className="command-tile__name">{`/sdd:${name}`}</span>
      </div>
      {description ? (
        <p className="command-tile__description">{description}</p>
      ) : null}
      {argumentHint ? (
        <code className="command-tile__hint">{command}</code>
      ) : null}
    </Link>
  );
}
