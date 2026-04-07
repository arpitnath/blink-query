import { Command } from 'commander';
import { Blink } from './blink.js';
import { startMCPServer } from './mcp.js';
import type { RecordType } from './types.js';

const program = new Command();

let _blink: Blink | null = null;
function getBlink(): Blink {
  if (!_blink) {
    const dbPath = program.opts().db;
    _blink = new Blink(dbPath ? { dbPath } : undefined);
  }
  return _blink;
}

program
  .name('blink')
  .description('DNS-inspired knowledge resolution layer for AI agents')
  .version('1.0.0')
  .option('--json', 'Output results as JSON')
  .option('--db <path>', 'Path to database file');

// --- save ---
program
  .command('save')
  .description('Save knowledge to a namespace')
  .requiredOption('--ns <namespace>', 'Target namespace (e.g. me, projects/orpheus)')
  .requiredOption('--title <title>', 'Record title')
  .option('--type <type>', 'Record type: SUMMARY, META, SOURCE, ALIAS', 'SUMMARY')
  .option('--tags <tags>', 'Comma-separated tags')
  .option('--ttl <seconds>', 'TTL in seconds', parseInt)
  .argument('[content]', 'Content (text for SUMMARY, JSON string for META/SOURCE/ALIAS)')
  .action((content: string | undefined, opts) => {
    let parsedContent: unknown = undefined;
    const summary = opts.type === 'SUMMARY' ? content : undefined;

    if (content && opts.type !== 'SUMMARY') {
      try {
        parsedContent = JSON.parse(content);
      } catch {
        parsedContent = content;
      }
    }

    const record = getBlink().save({
      namespace: opts.ns,
      title: opts.title,
      type: opts.type as RecordType,
      summary,
      content: parsedContent,
      tags: opts.tags ? opts.tags.split(',').map((t: string) => t.trim()) : [],
      ttl: opts.ttl,
    });

    if (program.opts().json) {
      console.log(JSON.stringify(record, null, 2));
      return;
    }

    console.log(`Saved: ${record.path}`);
    console.log(`  Type: ${record.type}`);
    console.log(`  ID: ${record.id}`);
  });

// --- resolve ---
program
  .command('resolve <path>')
  .description('Resolve a path to a typed record')
  .action((path: string) => {
    const result = getBlink().resolve(path);

    if (program.opts().json) {
      console.log(JSON.stringify(result, null, 2));
      if (result.status !== 'OK') process.exit(1);
      return;
    }

    if (result.status === 'NXDOMAIN') {
      console.log(`NXDOMAIN: ${path} not found`);
      process.exit(1);
    }

    if (result.status === 'ALIAS_LOOP') {
      console.log(`ALIAS_LOOP: ${path} — too many redirects`);
      process.exit(1);
    }

    const r = result.record!;
    console.log(`[${r.type}] ${r.title}`);
    console.log(`  Path: ${r.path}`);

    if (r.type === 'SUMMARY' && r.summary) {
      console.log(`  Summary: ${r.summary}`);
    } else if (r.type === 'META' && r.content) {
      console.log(`  Content: ${JSON.stringify(r.content, null, 2)}`);
    } else if (r.type === 'COLLECTION' && r.content) {
      const items = r.content as Array<{ path: string; title: string; type: string; hit_count: number }>;
      console.log(`  Children (${items.length}):`);
      for (const item of items) {
        console.log(`    [${item.type}] ${item.title} (${item.path}) — ${item.hit_count} hits`);
      }
    } else if (r.type === 'SOURCE' && r.content) {
      console.log(`  Source: ${JSON.stringify(r.content)}`);
      if (r.summary) console.log(`  Summary: ${r.summary}`);
    }

    if (r.tags.length > 0) console.log(`  Tags: ${r.tags.join(', ')}`);
    console.log(`  Hits: ${r.hit_count} | Tokens: ${r.token_count} | TTL: ${r.ttl}s`);
  });

// --- list ---
program
  .command('list <namespace>')
  .description('List records in a namespace')
  .option('--sort <sort>', 'Sort by: recent, hits, title', 'recent')
  .option('--limit <n>', 'Max results', parseInt)
  .option('--offset <n>', 'Skip first N results', parseInt, 0)
  .action((namespace: string, opts) => {
    const records = getBlink().list(namespace, opts.sort, { limit: opts.limit, offset: opts.offset });

    if (program.opts().json) {
      console.log(JSON.stringify(records, null, 2));
      return;
    }

    if (records.length === 0) {
      console.log(`No records in ${namespace}`);
      return;
    }

    console.log(`${namespace} (${records.length} records):\n`);
    for (const r of records) {
      const preview = r.summary ? r.summary.slice(0, 80) + (r.summary.length > 80 ? '...' : '') : '';
      console.log(`  [${r.type}] ${r.title}`);
      console.log(`    ${r.path} — ${r.hit_count} hits`);
      if (preview) console.log(`    ${preview}`);
      console.log();
    }
  });

// --- search ---
program
  .command('search <keywords...>')
  .description('Search records by keywords')
  .option('--limit <n>', 'Max results', parseInt, 10)
  .option('--offset <n>', 'Skip first N results', parseInt, 0)
  .option('--ns <namespace>', 'Limit to namespace')
  .action((keywords: string[], opts) => {
    const results = getBlink().search(keywords.join(' '), { namespace: opts.ns, limit: opts.limit, offset: opts.offset });

    if (program.opts().json) {
      console.log(JSON.stringify(results, null, 2));
      return;
    }

    if (results.length === 0) {
      console.log('No results found');
      return;
    }

    console.log(`Found ${results.length} results:\n`);
    for (const r of results) {
      console.log(`  [${r.type}] ${r.title}`);
      console.log(`    ${r.path}`);
      if (r.summary) console.log(`    ${r.summary.slice(0, 100)}${r.summary.length > 100 ? '...' : ''}`);
      console.log();
    }
  });

// --- query ---
program
  .command('query <querystring>')
  .description('Execute a Blink query')
  .action((querystring: string) => {
    try {
      const results = getBlink().query(querystring);

      if (program.opts().json) {
        console.log(JSON.stringify(results, null, 2));
        return;
      }

      if (results.length === 0) {
        console.log('No results');
        return;
      }

      console.log(`${results.length} results:\n`);
      for (const r of results) {
        console.log(`  [${r.type}] ${r.title}`);
        console.log(`    ${r.path} — ${r.hit_count} hits`);
        if (r.summary) console.log(`    ${r.summary.slice(0, 100)}${r.summary.length > 100 ? '...' : ''}`);
        console.log();
      }
    } catch (err) {
      if (program.opts().json) {
        console.log(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }, null, 2));
        process.exit(1);
      }
      console.error(`Query error: ${err instanceof Error ? err.message : err}`);
      process.exit(1);
    }
  });

// --- zones ---
program
  .command('zones')
  .description('List all zones with stats')
  .action(() => {
    const zones = getBlink().zones();

    if (program.opts().json) {
      console.log(JSON.stringify(zones, null, 2));
      return;
    }

    if (zones.length === 0) {
      console.log('No zones yet. Save a record to create one.');
      return;
    }

    console.log(`${zones.length} zones:\n`);
    for (const z of zones) {
      console.log(`  ${z.path}/`);
      console.log(`    Records: ${z.record_count} | TTL: ${z.default_ttl}s`);
      if (z.description) console.log(`    ${z.description}`);
      console.log(`    Last modified: ${z.last_modified}`);
      console.log();
    }
  });

// --- delete ---
program
  .command('delete <path>')
  .description('Delete a record')
  .action((path: string) => {
    const deleted = getBlink().delete(path);

    if (program.opts().json) {
      console.log(JSON.stringify({ deleted, path }, null, 2));
      if (!deleted) process.exit(1);
      return;
    }

    if (deleted) {
      console.log(`Deleted: ${path}`);
    } else {
      console.log(`Not found: ${path}`);
      process.exit(1);
    }
  });

// --- move ---
program
  .command('move <from> <to>')
  .description('Move a record to a new path')
  .action((from: string, to: string) => {
    const record = getBlink().move(from, to);

    if (program.opts().json) {
      console.log(JSON.stringify(record, null, 2));
      if (!record) process.exit(1);
      return;
    }

    if (record) {
      console.log(`Moved: ${from} → ${record.path}`);
    } else {
      console.log(`Not found: ${from}`);
      process.exit(1);
    }
  });

// --- ingest ---
program
  .command('ingest <directory>')
  .description('Ingest files from a directory into Blink records')
  .option('--ns <namespace>', 'Target namespace (default: derived from file paths)')
  .option('--prefix <prefix>', 'Namespace prefix to prepend', 'ingested')
  .option('--summary-length <chars>', 'Max summary length for extractive summarizer', parseInt, 500)
  .option('--ttl <seconds>', 'TTL for ingested records', parseInt)
  .option('--tags <tags>', 'Additional comma-separated tags')
  .option('--recursive', 'Recursively scan subdirectories (default: true)', true)
  .option('--no-recursive', 'Do not scan subdirectories')
  .action(async (directory: string, opts) => {
    const { loadDirectory, extractiveSummarize } = await import('./ingest.js');
    const { resolve: resolvePath } = await import('path');

    const absDir = resolvePath(directory);
    console.log(`Ingesting files from: ${absDir}`);

    const docs = await loadDirectory(absDir, { recursive: opts.recursive });
    console.log(`Found ${docs.length} documents`);

    if (docs.length === 0) {
      console.log('No supported files found.');
      return;
    }

    const result = await getBlink().ingest(docs, {
      summarize: extractiveSummarize(opts.summaryLength),
      namespace: opts.ns || undefined,
      namespacePrefix: opts.ns ? undefined : opts.prefix,
      ttl: opts.ttl,
      tags: opts.tags ? opts.tags.split(',').map((t: string) => t.trim()) : undefined,
    });

    if (program.opts().json) {
      console.log(JSON.stringify(result, null, 2));
      return;
    }

    console.log(`\nIngested ${result.records.length} records in ${result.elapsed}ms`);
    if (result.errors.length > 0) {
      console.log(`Errors: ${result.errors.length}`);
      for (const e of result.errors) {
        const fp = (e.document.metadata.file_path as string) || e.document.id;
        console.log(`  - ${fp}: ${e.error.message}`);
      }
    }

    for (const r of result.records) {
      console.log(`  [${r.type}] ${r.path}`);
    }
  });

// --- serve (MCP) ---
program
  .command('serve')
  .description('Start the MCP server (stdio transport)')
  .action(async () => {
    await startMCPServer(program.opts().db);
  });

// --- mcp (alias for serve, used by install configs) ---
program
  .command('mcp')
  .description('Start the MCP server (stdio transport)')
  .action(async () => {
    await startMCPServer(program.opts().db);
  });

// --- init ---
program
  .command('init')
  .description('Auto-detect AI agents and install blink MCP config for each')
  .option('--agent <name>', 'Install for a specific agent: claude-desktop, claude-code, cursor, codex')
  .option('--all', 'Install for all detected agents')
  .option('--db <path>', 'Override DB path written into configs')
  .action(async (opts) => {
    const {
      detectAgents,
      defaultDbPath,
      installClaudeDesktop,
      installClaudeCode,
      installCursor,
      installCodex,
    } = await import('./install/index.js');

    const dbPath = opts.db ?? program.opts().db ?? defaultDbPath();

    const agents = detectAgents();
    const targets = opts.agent
      ? agents.filter(a => a.name === opts.agent)
      : opts.all
        ? agents
        : agents.filter(a => a.installed);

    if (targets.length === 0) {
      if (opts.agent) {
        console.error(`Agent '${opts.agent}' not recognised or not detected.`);
        console.error('Valid agents: claude-desktop, claude-code, cursor, codex');
      } else {
        console.log('No supported AI agents detected.');
        console.log('Run with --all to install for all agents, or --agent <name> for a specific one.');
      }
      process.exit(1);
    }

    const installers: Record<string, (db: string) => { success: boolean; message: string; warning?: string; configPath: string }> = {
      'claude-desktop': installClaudeDesktop,
      'claude-code': installClaudeCode,
      'cursor': installCursor,
      'codex': installCodex,
    };

    let anyFailed = false;
    for (const agent of targets) {
      const installer = installers[agent.name];
      if (!installer) continue;
      try {
        const result = installer(dbPath);
        if (program.opts().json) {
          console.log(JSON.stringify(result, null, 2));
        } else {
          const icon = result.success ? '✓' : '✗';
          console.log(`${icon} ${agent.name}: ${result.message}`);
          if (result.warning) console.warn(`  Warning: ${result.warning}`);
        }
        if (!result.success) anyFailed = true;
      } catch (err) {
        console.error(`✗ ${agent.name}: ${err instanceof Error ? err.message : String(err)}`);
        anyFailed = true;
      }
    }

    if (anyFailed) process.exit(1);
  });

// --- doctor ---
program
  .command('doctor')
  .description('Check blink installation health across all agents')
  .action(async () => {
    const { checkHealth, defaultDbPath } = await import('./install/index.js');

    const dbPath = program.opts().db ?? defaultDbPath();
    const report = checkHealth(dbPath);

    if (program.opts().json) {
      console.log(JSON.stringify(report, null, 2));
      return;
    }

    const dbStatus = report.dbExists ? '✓ exists' : '✗ not found';
    console.log(`Database: ${report.dbPath}  [${dbStatus}]`);
    console.log();
    console.log('Agent status:');

    for (const agent of report.agents) {
      const installed = agent.installed ? '✓ installed' : '○ not detected';
      const configured = agent.blinkConfigured ? '✓ blink configured' : '○ not configured';
      console.log(`  ${agent.name.padEnd(16)} ${installed.padEnd(16)} ${configured}`);
      if (!agent.blinkConfigured && agent.installed) {
        console.log(`    → run: blink init --agent ${agent.name}`);
      }
    }

    console.log();
    if (!report.dbExists) {
      console.log('Tip: run `blink init` to set up MCP configs, then save your first record.');
    }
  });

// --- wiki subcommand group ---
const wiki = program
  .command('wiki')
  .description('Wiki management commands');

wiki
  .command('init')
  .description('Initialise a blink wiki (create default zones and schema record)')
  .option('--ns <namespace>', 'Root namespace for the wiki', 'wiki')
  .action((opts) => {
    const b = getBlink();
    const ns = opts.ns as string;

    // Create schema record
    b.save({
      namespace: ns,
      title: 'Wiki Schema',
      type: 'META',
      content: {
        version: '2.0.0',
        namespaces: [`${ns}/concepts`, `${ns}/references`, `${ns}/pages`],
        created: new Date().toISOString(),
      },
    });

    // Create zone placeholders
    for (const zone of ['concepts', 'references', 'pages']) {
      b.save({
        namespace: `${ns}/${zone}`,
        title: `${zone.charAt(0).toUpperCase()}${zone.slice(1)}`,
        type: 'SUMMARY',
        summary: `${zone} zone for the ${ns} wiki`,
      });
    }

    if (program.opts().json) {
      console.log(JSON.stringify({ status: 'ok', namespace: ns }, null, 2));
    } else {
      console.log(`Initialised wiki at namespace '${ns}'`);
      console.log(`  Created zones: ${ns}/concepts, ${ns}/references, ${ns}/pages`);
      console.log(`  Next: blink wiki ingest <directory> --ns ${ns}/pages`);
    }
  });

wiki
  .command('ingest <directory>')
  .description('Ingest markdown files into the wiki namespace')
  .option('--ns <namespace>', 'Target namespace', 'wiki/pages')
  .option('--summary-length <chars>', 'Max summary length', parseInt, 500)
  .option('--ttl <seconds>', 'TTL for ingested records', parseInt)
  .option('--tags <tags>', 'Comma-separated tags')
  .action(async (directory: string, opts) => {
    const { loadDirectory, extractiveSummarize } = await import('./ingest.js');
    const { resolve: resolvePath } = await import('path');

    const isJson = program.opts().json;
    const absDir = resolvePath(directory);
    if (!isJson) console.log(`Ingesting wiki files from: ${absDir}`);

    const docs = await loadDirectory(absDir, { recursive: true });
    if (!isJson) console.log(`Found ${docs.length} documents`);

    if (docs.length === 0) {
      if (isJson) {
        console.log(JSON.stringify({ records: [], errors: [], total: 0, elapsed: 0 }, null, 2));
      } else {
        console.log('No supported files found.');
      }
      return;
    }

    const result = await getBlink().ingest(docs, {
      summarize: extractiveSummarize(opts.summaryLength),
      namespace: opts.ns,
      ttl: opts.ttl,
      tags: opts.tags ? opts.tags.split(',').map((t: string) => t.trim()) : undefined,
    });

    if (isJson) {
      console.log(JSON.stringify(result, null, 2));
      return;
    }

    console.log(`\nIngested ${result.records.length} wiki records in ${result.elapsed}ms`);
    if (result.errors.length > 0) {
      console.log(`Errors: ${result.errors.length}`);
      for (const e of result.errors) {
        const fp = (e.document.metadata.file_path as string) || e.document.id;
        console.log(`  - ${fp}: ${e.error.message}`);
      }
    }
  });

wiki
  .command('lint')
  .description('Lint the wiki: check for broken ALIAS targets and orphaned records')
  .option('--ns <namespace>', 'Root namespace to lint', 'wiki')
  .action((opts) => {
    const b = getBlink();
    const ns = opts.ns as string;

    // Find all ALIAS records in the namespace
    const aliases = b.list(ns, 'recent', { limit: 1000 }).filter(r => r.type === 'ALIAS');
    const broken: Array<{ path: string; target: unknown }> = [];

    for (const alias of aliases) {
      const target = (alias.content as { target?: string } | null)?.target;
      if (!target) {
        broken.push({ path: alias.path, target: null });
        continue;
      }
      const resolved = b.get(target);
      if (!resolved) {
        broken.push({ path: alias.path, target });
      }
    }

    if (program.opts().json) {
      console.log(JSON.stringify({ namespace: ns, aliases: aliases.length, broken }, null, 2));
      if (broken.length > 0) process.exit(1);
      return;
    }

    console.log(`Lint: namespace '${ns}'`);
    console.log(`  Aliases checked: ${aliases.length}`);
    if (broken.length === 0) {
      console.log('  No broken aliases found.');
    } else {
      console.log(`  Broken aliases: ${broken.length}`);
      for (const b of broken) {
        console.log(`    ${b.path} → ${b.target ?? '(no target)'}`);
      }
      process.exit(1);
    }
  });

program.parse();
