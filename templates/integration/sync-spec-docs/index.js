/**
 * sync-spec-docs - Docusaurus Plugin
 *
 * A build-time plugin that syncs ADRs and OpenSpec specifications from
 * the project's canonical source directories into the Docusaurus docs tree.
 *
 * Applies the same transforms as the standalone docs-site scaffolding:
 * - RFC 2119 keyword highlighting
 * - ADR/spec cross-reference linking
 * - Status/Date/Domain badge components
 * - Requirement box components for spec tables
 * - Consequence keyword highlighting (Good/Bad/Neutral)
 * - MDX v3 safety escaping
 *
 * Usage in docusaurus.config.ts:
 *
 *   plugins: [
 *     ['./plugins/sync-spec-docs', {
 *       projectRoot: '..',      // relative path from site dir to project root
 *       docsPath: 'docs',       // relative path from site dir to docs content directory
 *     }],
 *   ],
 *
 * @param {Object} context - Docusaurus context (siteDir, siteConfig, etc.)
 * @param {Object} options - Plugin options
 * @param {string} [options.projectRoot='..'] - Path to project root relative to site dir
 * @param {string} [options.docsPath='docs'] - Path to docs content dir relative to site dir
 */

const path = require('path');
const fs = require('fs');
const { buildSpecMapping } = require('./lib/build-spec-mapping');
const { transformAdrs } = require('./lib/transform-adrs');
const { transformOpenspecs } = require('./lib/transform-openspecs');
const { generateIndex } = require('./lib/generate-index');
const { generateGraph } = require('./lib/generate-graph');

module.exports = function pluginSyncSpecDocs(context, options = {}) {
  const projectRoot = path.resolve(context.siteDir, options.projectRoot || '..');
  const docsPath = options.docsPath || 'docs';
  const outputBase = path.join(context.siteDir, docsPath, 'architecture');
  const adrsSource = path.join(projectRoot, 'docs', 'adrs');
  const specsSource = path.join(projectRoot, 'docs', 'openspec', 'specs');

  return {
    name: 'sync-spec-docs',

    async loadContent() {
      if (!fs.existsSync(projectRoot)) {
        console.warn(`[sync-spec-docs] WARNING: projectRoot does not exist: ${projectRoot}`);
        console.warn('  Check the projectRoot option in your docusaurus.config');
        return;
      }

      const baseUrl = context.siteConfig.baseUrl.replace(/\/$/, '');
      const pathPrefix = '/architecture';

      console.log('[sync-spec-docs] Syncing design documents...');
      console.log(`  Project root: ${projectRoot}`);
      console.log(`  ADRs source: ${adrsSource}`);
      console.log(`  Specs source: ${specsSource}`);
      console.log(`  Output: ${outputBase}`);

      // 1. Build spec mapping (needed by transforms for cross-references)
      const { specMapping, specEmojis } = buildSpecMapping({
        specsSource,
        pathPrefix,
      });

      // 2. Transform ADRs
      transformAdrs({
        adrsSource,
        adrsDest: path.join(outputBase, 'decisions'),
        baseUrl,
        pathPrefix,
        specMapping,
        specEmojis,
      });

      // 3. Transform OpenSpecs
      transformOpenspecs({
        specsSource,
        specsDest: path.join(outputBase, 'specs'),
        adrsSource,
        baseUrl,
        pathPrefix,
        specMapping,
        specEmojis,
      });

      // 4. Generate index page
      generateIndex({
        adrsSource,
        specsSource,
        outputDir: outputBase,
        projectTitle: context.siteConfig.title,
      });

      // 5. Generate graph page (artifact DAG, per ADR-0023 / SPEC-0018)
      generateGraph({
        adrsSource,
        specsSource,
        outputDir: outputBase,
      });

      console.log('[sync-spec-docs] Sync complete.');
    },

    getPathsToWatch() {
      // Use forward slashes for chokidar/glob compatibility (path.join uses \ on Windows)
      return [
        `${adrsSource}/**/*.md`,
        `${specsSource}/**/*.md`,
      ];
    },
  };
};
