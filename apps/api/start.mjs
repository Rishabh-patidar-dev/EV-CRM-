// =============================================================================
// start.mjs — production launcher.
// -----------------------------------------------------------------------------
// WHY THIS EXISTS
//
// The API used to start with `tsx src/index.ts`, so a host needed no build step
// at all. It now prefers compiled output (`node dist/index.js`), because
// transpiling the whole codebase on every boot is startup time and memory spent
// for nothing in production.
//
// That change moved a requirement onto the host's build command, and the first
// deploy after it failed: Render sets NODE_ENV=production, which makes
// `npm install` skip devDependencies — so `typescript` wasn't installed and the
// build step had no compiler. (`tsx` and `typescript` are now regular
// dependencies for exactly that reason.)
//
// The lesson is that this launcher must not assume anything about how the host
// is configured. So, in order:
//
//   1. Compiled output present and current  -> run it (the fast path).
//   2. Missing or stale                     -> build it, then run it.
//   3. Build not possible for any reason    -> run from source via tsx.
//
// Step 3 is the old behaviour, kept as a floor: a slower boot is a bad day, a
// service that refuses to start is an outage.
// =============================================================================
import { existsSync, statSync, readdirSync } from "node:fs";
import { execSync, spawn } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const compiledEntry = join(here, "dist", "index.js");
const sourceEntry = join(here, "src", "index.ts");
const srcDir = join(here, "src");

const log = (msg) => console.log(`[start] ${msg}`);

/** Most recent mtime anywhere under a directory. */
function newestMtime(dir) {
  let newest = 0;
  for (const item of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, item.name);
    const mtime = item.isDirectory() ? newestMtime(full) : statSync(full).mtimeMs;
    if (mtime > newest) newest = mtime;
  }
  return newest;
}

function compiledIsUsable() {
  if (!existsSync(compiledEntry)) return false;
  try {
    // dist older than src means the host deployed new code without rebuilding.
    // Running it would silently serve the previous release.
    return newestMtime(srcDir) <= statSync(compiledEntry).mtimeMs;
  } catch {
    // If the comparison itself fails, trust what's on disk rather than
    // rebuilding on every single boot.
    return true;
  }
}

/** Runs the compiled build in THIS process, so signal handling stays intact. */
async function runCompiled() {
  log("starting from compiled output (dist/)");
  // Imported, not spawned: server.js installs SIGTERM/SIGINT handlers for
  // graceful shutdown, and those only work if it owns the real process.
  //
  // pathToFileURL is required, not cosmetic: dynamic import() of a bare
  // absolute path throws on Windows ("absolute paths must be valid file://
  // URLs") because a drive letter reads as a URL scheme.
  await import(pathToFileURL(compiledEntry).href);
}

/** Last resort — run TypeScript directly, the way this service used to. */
function runFromSource() {
  log("starting from source via tsx (slower boot; compiled output unavailable)");
  // `node --import tsx <entry>` rather than `npx tsx <entry>`: no shell, so
  // paths containing spaces can't be word-split, no npx resolution step, and
  // it reuses the exact node binary already running instead of whichever one
  // happens to be first on PATH.
  const child = spawn(process.execPath, ["--import", "tsx", sourceEntry], {
    cwd: here,
    stdio: "inherit",
  });
  // Forward shutdown signals so draining still works through the extra process.
  for (const sig of ["SIGTERM", "SIGINT"]) {
    process.on(sig, () => child.kill(sig));
  }
  child.on("exit", (code, signal) => process.exit(signal ? 1 : (code ?? 0)));
}

async function main() {
  if (compiledIsUsable()) {
    await runCompiled();
    return;
  }

  log(existsSync(compiledEntry) ? "compiled output is stale — rebuilding" : "no compiled output — building");
  log("tip: set the host's build command to `npm run build` so this happens at build time, not boot");

  try {
    execSync("npm run build", { cwd: here, stdio: "inherit" });
  } catch {
    log("build failed — falling back to running from source");
    runFromSource();
    return;
  }

  if (!existsSync(compiledEntry)) {
    log("build produced no entry point — falling back to running from source");
    runFromSource();
    return;
  }

  await runCompiled();
}

main().catch((err) => {
  console.error("[start] compiled entry failed to load:", err?.message ?? err);
  console.error("[start] falling back to running from source");
  runFromSource();
});
