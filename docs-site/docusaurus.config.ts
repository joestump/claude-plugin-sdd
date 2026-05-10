import {themes as prismThemes} from 'prism-react-renderer';
import type {Config} from '@docusaurus/types';
import type * as Preset from '@docusaurus/preset-classic';

// ============================================================
// CONFIGURE THESE VALUES FOR YOUR PROJECT
// ============================================================
const PROJECT_TITLE = 'Claude Plugin: Spec-Driven Development';
const PROJECT_TAGLINE = 'Decide. Specify. Plan. Build. Validate.';
const GITHUB_URL = 'https://github.com/joestump/claude-plugin-sdd';
const SITE_URL = 'https://joestump.github.io';
const BASE_URL = '/claude-plugin-sdd/';
// ============================================================

// Governing: ADR-0029, SPEC-0021 REQ "Migration of commands.mdx (Step 2 — Audit and Redirect)".
// One redirect per fragment anchor present in HEAD's commands.mdx at this
// PR's open time. Fifteen anchors map to skill pages; eight anchors are
// section/group headings that map to the hero-tile index. Reviewers can
// re-derive this list with:
//   grep -oE '\{#[a-z-]+\}' docs-site/content/guides/commands.mdx | sort -u
const SKILL_ANCHORS = [
  'adr', 'audit', 'check', 'discover', 'docs', 'enrich', 'init',
  'list', 'organize', 'plan', 'prime', 'review', 'spec', 'status', 'work',
];
const GROUP_ANCHORS = [
  'creating', 'discovery', 'documentation', 'drift',
  'implementation', 'lifecycle', 'planning', 'session',
];
const COMMANDS_REDIRECTS = [
  // Skill-level: /guides/commands#{name} -> /skills/{name}
  ...SKILL_ANCHORS.map((name) => ({
    from: `/guides/commands#${name}`,
    to: `/skills/${name}`,
  })),
  // Group-level: /guides/commands#{group} -> /skills/ (the hero-tile index).
  ...GROUP_ANCHORS.map((group) => ({
    from: `/guides/commands#${group}`,
    to: `/skills/`,
  })),
  // Bare /guides/commands -> /skills/
  {from: '/guides/commands', to: '/skills/'},
];

const config: Config = {
  title: PROJECT_TITLE,
  tagline: PROJECT_TAGLINE,
  favicon: 'img/favicon.ico',

  future: {
    v4: true,
  },

  url: SITE_URL,
  baseUrl: BASE_URL,

  onBrokenLinks: 'warn',
  onBrokenMarkdownLinks: 'warn',

  markdown: {
    format: 'detect',
    mermaid: true,
  },

  themes: ['@docusaurus/theme-mermaid'],

  // Governing: ADR-0029, SPEC-0021 REQ "Migration of commands.mdx (Step 2 — Audit and Redirect)".
  plugins: [
    [
      '@docusaurus/plugin-client-redirects',
      {
        redirects: COMMANDS_REDIRECTS,
      },
    ],
  ],

  i18n: {
    defaultLocale: 'en',
    locales: ['en'],
  },

  presets: [
    [
      'classic',
      {
        docs: {
          path: '../docs-generated',
          sidebarPath: './sidebars.ts',
          routeBasePath: '/',
        },
        blog: false,
        theme: {
          customCss: './src/css/custom.css',
        },
      } satisfies Preset.Options,
    ],
  ],

  themeConfig: {
    colorMode: {
      respectPrefersColorScheme: true,
    },
    navbar: {
      title: PROJECT_TITLE,
      items: [
        {
          type: 'docSidebar',
          sidebarId: 'guidesSidebar',
          position: 'left',
          label: 'Guides',
        },
        // Governing: ADR-0029, SPEC-0021 REQ "Routing, Sidebar, and Navbar".
        // The Skills entry MUST sit between Guides and ADRs.
        {
          type: 'docSidebar',
          sidebarId: 'skillsSidebar',
          position: 'left',
          label: 'Skills',
        },
        {
          type: 'docSidebar',
          sidebarId: 'decisionsSidebar',
          position: 'left',
          label: 'ADRs',
        },
        {
          type: 'docSidebar',
          sidebarId: 'specsSidebar',
          position: 'left',
          label: 'Specifications',
        },
        {
          href: GITHUB_URL,
          label: 'GitHub',
          position: 'right',
        },
      ],
    },
    footer: {
      style: 'dark',
      links: [
        {
          title: 'Documentation',
          items: [
            {
              label: 'Workflow',
              to: '/guides/workflow',
            },
            // Governing: ADR-0029, SPEC-0021 REQ "Migration of commands.mdx (Step 2 — Audit and Redirect)".
            // Inbound footer link rewritten from /guides/commands to /skills/.
            {
              label: 'Skills',
              to: '/skills/',
            },
            {
              label: 'Sprint Planning',
              to: '/guides/sprint-planning',
            },
            {
              label: 'Architecture Decisions',
              to: '/decisions',
            },
            {
              label: 'Specifications',
              to: '/specs',
            },
          ],
        },
        {
          title: 'More',
          items: [
            {
              label: 'GitHub',
              href: GITHUB_URL,
            },
          ],
        },
      ],
      copyright: `Copyright © ${new Date().getFullYear()} Claude Plugin: Spec-Driven Development. Built with Docusaurus.`,
    },
    prism: {
      theme: prismThemes.github,
      darkTheme: prismThemes.dracula,
      additionalLanguages: ['go', 'bash', 'yaml', 'markdown'],
    },
  } satisfies Preset.ThemeConfig,
};

export default config;
