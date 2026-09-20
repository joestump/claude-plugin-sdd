import type {ReactNode} from 'react';
import clsx from 'clsx';
import Link from '@docusaurus/Link';
import useDocusaurusContext from '@docusaurus/useDocusaurusContext';
import Layout from '@theme/Layout';
import HomepageFeatures from '@site/src/components/HomepageFeatures';
import Heading from '@theme/Heading';

import skillManifest from '@site/../skills/_index.json';

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

/**
 * One-line blurbs for the skill grid.
 *
 * The ORDER and MEMBERSHIP of the grid come from `skills/_index.json`, not
 * from this map — it supplies wording only. That split is deliberate: this
 * page used to carry its own hardcoded array of skills, and it silently fell
 * three behind (`index`, `respond`, and `prd` all shipped without ever
 * appearing on the homepage). A skill missing from this map now renders with
 * its name alone rather than disappearing, and `make lint` fails on the gap.
 */
const SKILL_BLURBS: Record<string, string> = {
  prd:               'Capture client-facing product intent before the ADR',
  adr:               'Create a new Architecture Decision Record',
  spec:              'Create a new specification',
  plan:              'Break specs into sprint issues',
  organize:          'Group issues into tracker projects',
  enrich:            'Add branch/PR conventions to issues',
  work:              'Implement issues in parallel worktrees',
  review:            'Review and merge PRs with spec-aware pairs',
  respond:           'Address review feedback on a PR and reply',
  check:             'Quick-check code for drift',
  audit:             'Comprehensive alignment audit',
  discover:          'Discover implicit architecture',
  search:            'Search ADRs and specs with hybrid retrieval',
  docs:              'Generate this documentation site',
  graph:             'Build and query the artifact graph',
  index:             'Index artifacts and code into qmd collections',
  init:              'Set up CLAUDE.md for the plugin',
  prime:             'Load architecture context into session',
  list:              'List all PRDs, ADRs, and specs with status',
  status:            'Update the status of a PRD, ADR, or spec',
  'report-friction': 'File feedback when a skill causes churn',
};

/**
 * `index.mdx` is the skills overview's reserved filename, so the skill named
 * `index` is served from `/skills/index-skill`. Mirrors pageFileBase() in
 * scripts/transform-skills.js — see that file for why the route moved.
 */
function skillHref(name: string): string {
  return `/skills/${name === 'index' ? 'index-skill' : name}`;
}

const SKILLS: { name: string; description: string }[] = Object.values(
  skillManifest as Record<string, string[]>,
)
  .flat()
  .map((name) => ({ name, description: SKILL_BLURBS[name] ?? '' }));

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
            <Link key={name} to={skillHref(name)} className={styles.skillCard}>
              <code>/sdd:{name}</code>
              {description && <span>{description}</span>}
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
