import { Command } from 'commander';
import { Blink } from './blink.js';
import { startMCPServer } from './mcp.js';
import type { RecordType } from './types.js';

const blink = new Blink();

const program = new Command();

program
  .name('blink')
  .description('DNS-inspired knowledge resolution layer for AI agents')
  .version('0.1.0');

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

    const record = blink.save({
      namespace: opts.ns,
      title: opts.title,
      type: opts.type as RecordType,
      summary,
      content: parsedContent,
      tags: opts.tags ? opts.tags.split(',').map((t: string) => t.trim()) : [],
      ttl: opts.ttl,
    });

    console.log(`Saved: ${record.path}`);
    console.log(`  Type: ${record.type}`);
    console.log(`  ID: ${record.id}`);
  });

// --- resolve ---
program
  .command('resolve <path>')
  .description('Resolve a path to a typed record')
  .action((path: string) => {
    const result = blink.resolve(path);

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
  .action((namespace: string, opts) => {
    const records = blink.list(namespace, opts.sort);

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
  .option('--ns <namespace>', 'Limit to namespace')
  .action((keywords: string[], opts) => {
    const results = blink.search(keywords.join(' '), opts.ns, opts.limit);

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
      const results = blink.query(querystring);

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
      console.error(`Query error: ${err instanceof Error ? err.message : err}`);
      process.exit(1);
    }
  });

// --- zones ---
program
  .command('zones')
  .description('List all zones with stats')
  .action(() => {
    const zones = blink.zones();

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
    const deleted = blink.delete(path);
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
    const record = blink.move(from, to);
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

    const result = await blink.ingest(docs, {
      summarize: extractiveSummarize(opts.summaryLength),
      namespace: opts.ns || undefined,
      namespacePrefix: opts.ns ? undefined : opts.prefix,
      ttl: opts.ttl,
      tags: opts.tags ? opts.tags.split(',').map((t: string) => t.trim()) : undefined,
    });

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
    await startMCPServer();
  });

program.parse();
