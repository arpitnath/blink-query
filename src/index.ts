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

program.parse();
