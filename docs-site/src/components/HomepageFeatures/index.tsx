import type {ReactNode} from 'react';
import clsx from 'clsx';
import Link from '@docusaurus/Link';
import Heading from '@theme/Heading';
import {FileText, ScrollText, SearchCheck, ListTodo} from 'lucide-react';
import styles from './styles.module.css';

type FeatureItem = {
  title: string;
  Icon: React.ComponentType<{size?: number; strokeWidth?: number; className?: string}>;
  description: ReactNode;
  link: string;
};

const FeatureList: FeatureItem[] = [
  {
    title: 'Architecture Decisions',
    Icon: FileText,
    link: '/skills/adr',
    description: (
      <>
        Record decisions using the MADR format with structured sections for
        context, options, consequences, and Mermaid diagrams. Every choice
        gets the rationale it deserves.
      </>
    ),
  },
  {
    title: 'OpenSpec Specifications',
    Icon: ScrollText,
    link: '/skills/spec',
    description: (
      <>
        Formal requirements with RFC 2119 keywords and WHEN/THEN scenarios.
        Paired spec + design documents separate the &quot;what&quot; from
        the &quot;how&quot; so each can evolve independently.
      </>
    ),
  },
  {
    title: 'Sprint Planning',
    Icon: ListTodo,
    link: '/skills/plan',
    description: (
      <>
        Break specifications into actionable sprint issues. Supports
        Beads, GitHub, GitLab, Gitea, Jira, and Linear so your
        architecture flows straight into your tracker.
      </>
    ),
  },
  {
    title: 'Drift Detection',
    Icon: SearchCheck,
    link: '/skills/',
    description: (
      <>
        Quick-check files against specs or run a full audit across
        the project. Catch when code drifts from decisions before
        it becomes technical debt.
      </>
    ),
  },
];

function Feature({title, Icon, description, link}: FeatureItem) {
  return (
    <div className={clsx('col col--3')}>
      <Link to={link} className={styles.featureLink}>
        <div className="text--center">
          <Icon size={64} strokeWidth={1.5} className={styles.featureIcon} />
        </div>
        <div className="text--center padding-horiz--md">
          <Heading as="h3">{title}</Heading>
          <p>{description}</p>
        </div>
      </Link>
    </div>
  );
}

export default function HomepageFeatures(): ReactNode {
  return (
    <section className={styles.features}>
      <div className="container">
        <div className="row">
          {FeatureList.map((props, idx) => (
            <Feature key={idx} {...props} />
          ))}
        </div>
      </div>
    </section>
  );
}
