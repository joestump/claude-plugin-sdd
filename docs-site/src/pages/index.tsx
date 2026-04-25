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
          <div className={styles.skillCard}>
            <code>/sdd:adr</code>
            <span>Create a new Architecture Decision Record</span>
          </div>
          <div className={styles.skillCard}>
            <code>/sdd:spec</code>
            <span>Create a new specification</span>
          </div>
          <div className={styles.skillCard}>
            <code>/sdd:plan</code>
            <span>Break specs into sprint issues</span>
          </div>
          <div className={styles.skillCard}>
            <code>/sdd:organize</code>
            <span>Group issues into tracker projects</span>
          </div>
          <div className={styles.skillCard}>
            <code>/sdd:enrich</code>
            <span>Add branch/PR conventions to issues</span>
          </div>
          <div className={styles.skillCard}>
            <code>/sdd:work</code>
            <span>Implement issues in parallel worktrees</span>
          </div>
          <div className={styles.skillCard}>
            <code>/sdd:check</code>
            <span>Quick-check code for drift</span>
          </div>
          <div className={styles.skillCard}>
            <code>/sdd:audit</code>
            <span>Comprehensive alignment audit</span>
          </div>
          <div className={styles.skillCard}>
            <code>/sdd:discover</code>
            <span>Discover implicit architecture</span>
          </div>
          <div className={styles.skillCard}>
            <code>/sdd:docs</code>
            <span>Generate this documentation site</span>
          </div>
          <div className={styles.skillCard}>
            <code>/sdd:prime</code>
            <span>Load architecture context into session</span>
          </div>
          <div className={styles.skillCard}>
            <code>/sdd:init</code>
            <span>Set up CLAUDE.md for the plugin</span>
          </div>
          <div className={styles.skillCard}>
            <code>/sdd:list</code>
            <span>List all ADRs and specs with status</span>
          </div>
          <div className={styles.skillCard}>
            <code>/sdd:status</code>
            <span>Update the status of an ADR or spec</span>
          </div>
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
