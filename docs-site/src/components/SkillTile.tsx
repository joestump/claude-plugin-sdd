import React, {ReactElement} from 'react';
import Link from '@docusaurus/Link';
import clsx from 'clsx';

/**
 * Hero-tile rendering for the /skills/ index page. Each tile carries the
 * skill's name, a truncated description, the argument hint, and a link to
 * the per-skill page.
 *
 * Governing: ADR-0029, SPEC-0021 REQ "Hero-Tile Index Page".
 */
interface SkillTileProps {
  name: string;
  description?: string;
  argumentHint?: string;
  href: string;
  className?: string;
}

export default function SkillTile({
  name,
  description,
  argumentHint,
  href,
  className,
}: SkillTileProps): ReactElement {
  const command = `/sdd:${name}${argumentHint ? ' ' + argumentHint : ''}`;
  return (
    <Link to={href} className={clsx('skill-tile', className)}>
      <div className="skill-tile__header">
        <span className="skill-tile__name">{`/sdd:${name}`}</span>
      </div>
      {description ? (
        <p className="skill-tile__description">{description}</p>
      ) : null}
      {argumentHint ? (
        <code className="skill-tile__hint">{command}</code>
      ) : null}
    </Link>
  );
}
