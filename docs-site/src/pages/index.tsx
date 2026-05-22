import type {ReactNode} from 'react';
import clsx from 'clsx';
import Link from '@docusaurus/Link';
import useDocusaurusContext from '@docusaurus/useDocusaurusContext';
import Layout from '@theme/Layout';
import HomepageFeatures from '@site/src/components/HomepageFeatures';
import Heading from '@theme/Heading';

import styles from './index.module.css';

function HomepageHeader() {
  const {siteConfig} = useDocusaurusContext();
  return (
    <header className={clsx('hero hero--primary', styles.heroBanner)}>
      <div className="container">
        <Heading as="h1" className="hero__title">
          {siteConfig.title}
        </Heading>
        <p className="hero__subtitle">{siteConfig.tagline}</p>
        <div className={styles.buttons}>
          <Link
            className="button button--secondary button--lg"
            to="/overview">
            Browse Documentation
          </Link>
        </div>
      </div>
    </header>
  );
}

const SKILLS: { name: string; description: string }[] = [
  { name: 'adr',            description: 'Create a new Architecture Decision Record' },
  { name: 'spec',           description: 'Create a new specification' },
  { name: 'plan',           description: 'Break specs into sprint issues' },
  { name: 'organize',       description: 'Group issues into tracker projects' },
  { name: 'enrich',         description: 'Add branch/PR conventions to issues' },
  { name: 'work',           description: 'Implement issues in parallel worktrees' },
  { name: 'review',         description: 'Review and merge PRs with spec-aware pairs' },
  { name: 'check',          description: 'Quick-check code for drift' },
  { name: 'audit',          description: 'Comprehensive alignment audit' },
  { name: 'discover',       description: 'Discover implicit architecture' },
  { name: 'search',         description: 'Search ADRs and specs with hybrid retrieval' },
  { name: 'docs',           description: 'Generate this documentation site' },
  { name: 'graph',          description: 'Build and query the artifact graph' },
  { name: 'init',           description: 'Set up CLAUDE.md for the plugin' },
  { name: 'prime',          description: 'Load architecture context into session' },
  { name: 'list',           description: 'List all ADRs and specs with status' },
  { name: 'status',         description: 'Update the status of an ADR or spec' },
  { name: 'report-friction', description: 'File feedback when a skill causes churn' },
];

function SkillsSection() {
  return (
    <section className={styles.skills}>
      <div className="container">
        <Heading as="h2" className="text--center">
          Skills
        </Heading>
        <p className="text--center">
          Claude Code slash commands for managing your architecture artifacts.
        </p>
        <div className={styles.skillGrid}>
          {SKILLS.map(({ name, description }) => (
            <Link key={name} to={`/skills/${name}`} className={styles.skillCard}>
              <code>/sdd:{name}</code>
              <span>{description}</span>
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
}

export default function Home(): ReactNode {
  const {siteConfig} = useDocusaurusContext();
  return (
    <Layout
      title={siteConfig.title}
      description="Architecture governance for Claude Code. Record decisions, write specs, detect drift, and generate documentation.">
      <HomepageHeader />
      <main>
        <HomepageFeatures />
        <SkillsSection />
      </main>
    </Layout>
  );
}
