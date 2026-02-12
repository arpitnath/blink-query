/**
 * Blink Library API Test
 *
 * Tests the developer experience of using blink-query as an npm package.
 * This is what a developer would write to integrate Blink into their app.
 */

import { Blink } from "blink-query";
import type { BlinkRecord, ResolveResponse } from "blink-query";

// Helper to print test results
function pass(name: string, detail?: string) {
  console.log(`  ✓ ${name}${detail ? ` — ${detail}` : ""}`);
}

function fail(name: string, error: unknown) {
  console.log(`  ✗ ${name} — ${error}`);
  process.exitCode = 1;
}

console.log("\n" + "=".repeat(60));
console.log("  BLINK LIBRARY API TEST");
console.log("  Testing: import { Blink } from 'blink-query'");
console.log("=".repeat(60) + "\n");

// Create an in-memory instance (no file system side effects)
const blink = new Blink({ dbPath: ":memory:" });

// ─── Test 1: Save and resolve a SUMMARY ─────────────────────
console.log("Test 1: Save and resolve SUMMARY");
try {
  const record = blink.save({
    namespace: "me",
    title: "Background",
    type: "SUMMARY",
    summary: "Full-stack developer, 28, loves TypeScript and Go. Building AI tools.",
    tags: ["personal", "developer"],
  });
  pass("save()", `path=${record.path}, id=${record.id}`);

  const result = blink.resolve("me/background");
  pass("resolve()", `status=${result.status}, type=${result.record!.type}`);

  if (result.record!.summary!.includes("Full-stack")) {
    pass("content correct", result.record!.summary!.slice(0, 50) + "...");
  }
} catch (e) {
  fail("SUMMARY save/resolve", e);
}

// ─── Test 2: Save and resolve META ──────────────────────────
console.log("\nTest 2: Save and resolve META");
try {
  blink.save({
    namespace: "me",
    title: "Preferences",
    type: "META",
    content: {
      language: "TypeScript",
      framework: "React",
      state: "Zustand",
      style: "functional only",
      testing: "vitest",
    },
    tags: ["coding", "preferences"],
  });
  pass("save()", "META record saved");

  const result = blink.resolve("me/preferences");
  const content = result.record!.content as Record<string, string>;
  pass("resolve()", `language=${content.language}, framework=${content.framework}`);
} catch (e) {
  fail("META save/resolve", e);
}

// ─── Test 3: Namespace browsing (auto-COLLECTION) ───────────
console.log("\nTest 3: Namespace browsing → auto-COLLECTION");
try {
  const result = blink.resolve("me/");
  pass("resolve('me/')", `status=${result.status}, type=${result.record!.type}`);

  const children = result.record!.content as Array<{ path: string; title: string; type: string }>;
  pass("children", `${children.length} records: ${children.map((c) => `[${c.type}] ${c.title}`).join(", ")}`);
} catch (e) {
  fail("auto-COLLECTION", e);
}

// ─── Test 4: Keyword search ────────────────────────────────
console.log("\nTest 4: Keyword search");
try {
  blink.save({
    namespace: "discoveries/pattern",
    title: "JWT Auth Pattern",
    summary: "Access tokens 15min in memory, refresh tokens 7d in httpOnly cookies. Rotate on refresh.",
    tags: ["auth", "jwt", "security"],
  });

  const results = blink.search("jwt auth");
  pass("search('jwt auth')", `found ${results.length} results`);
  pass("top result", `[${results[0].type}] ${results[0].title}`);
} catch (e) {
  fail("keyword search", e);
}

// ─── Test 5: Query DSL ──────────────────────────────────────
console.log("\nTest 5: Query DSL");
try {
  const results = blink.query("discoveries where tag='auth' order by hit_count desc limit 5");
  pass("query()", `${results.length} results matching tag='auth'`);

  const allDiscoveries = blink.query("discoveries");
  pass("query('discoveries')", `${allDiscoveries.length} total in namespace`);
} catch (e) {
  fail("query DSL", e);
}

// ─── Test 6: saveMany (bulk ingestion) ──────────────────────
console.log("\nTest 6: Bulk save with saveMany()");
try {
  const records = blink.saveMany([
    { namespace: "projects/myapp", title: "Architecture", type: "SUMMARY", summary: "Next.js 14 with app router, Prisma ORM, PostgreSQL" },
    { namespace: "projects/myapp", title: "Conventions", type: "META", content: { testing: "vitest", naming: "kebab-case", maxLineLength: 100 } },
    { namespace: "projects/myapp", title: "Known Bugs", type: "SUMMARY", summary: "Cart total shows stale price on currency switch" },
  ]);
  pass("saveMany()", `saved ${records.length} records in single transaction`);

  const list = blink.list("projects/myapp");
  pass("list()", `${list.length} records in projects/myapp`);
} catch (e) {
  fail("saveMany", e);
}

// ─── Test 7: ALIAS resolution ───────────────────────────────
console.log("\nTest 7: ALIAS redirect");
try {
  blink.save({
    namespace: "shortcuts",
    title: "Auth",
    type: "ALIAS",
    content: { target: "discoveries/pattern/jwt-auth-pattern" },
  });

  const result = blink.resolve("shortcuts/auth");
  pass("resolve alias", `followed redirect → [${result.record!.type}] ${result.record!.title}`);
  pass("target content", result.record!.summary!.slice(0, 60) + "...");
} catch (e) {
  fail("ALIAS resolution", e);
}

// ─── Test 8: Zones ──────────────────────────────────────────
console.log("\nTest 8: Zone listing");
try {
  const zones = blink.zones();
  pass("zones()", `${zones.length} zones`);
  for (const z of zones) {
    console.log(`    ${z.path}/ — ${z.record_count} records`);
  }
} catch (e) {
  fail("zones", e);
}

// ─── Test 9: Delete and move ────────────────────────────────
console.log("\nTest 9: Delete and move");
try {
  blink.save({ namespace: "temp", title: "Throwaway", summary: "delete me" });
  const deleted = blink.delete("temp/throwaway");
  pass("delete()", `deleted=${deleted}`);

  blink.save({ namespace: "old", title: "Topic", summary: "move me" });
  const moved = blink.move("old/topic", "archive/topic");
  pass("move()", `moved to ${moved!.path}`);
} catch (e) {
  fail("delete/move", e);
}

// ─── Test 10: Type exports work ─────────────────────────────
console.log("\nTest 10: Type exports");
try {
  // This is a compile-time check — if types don't export, tsx will fail
  const record: BlinkRecord = blink.get("me/background")!;
  const response: ResolveResponse = blink.resolve("me/background");
  pass("BlinkRecord type", "imported and usable");
  pass("ResolveResponse type", `status type = ${response.status}`);
} catch (e) {
  fail("type exports", e);
}

// ─── Summary ────────────────────────────────────────────────
console.log("\n" + "=".repeat(60));
console.log("  LIBRARY API TEST COMPLETE");
console.log("=".repeat(60));

blink.close();
