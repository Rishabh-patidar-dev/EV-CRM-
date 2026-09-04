// =============================================================================
// ensure-build.mjs — npm `prestart` guard.
// -----------------------------------------------------------------------------
// The API used to start with `tsx src/index.ts`, which needed no build step, so
// a host could be configured with nothing but an install command and it would
// run. It now starts from compiled output (`node dist/index.js`) because
// transpiling TypeScript on every boot in production is wasted startup time and
// wasted memory.
//
// That change moves a requirement onto the host's build command, and a host
// still configured the old way would fail at boot with a bare
// "Cannot find module dist/index.js" — a broken deploy for a reason that has
// nothing to do with the code.
//
// So: if the build output is missing or stale, build it here rather than
// failing. The correct setup is still to run `npm run build` in the host's
// build phase — this is the safety net for when it isn't, not a replacement.
// =============================================================================
import { existsSync, statSync, readdirSync } from "node:fs";
import { execSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const entry = join(here, "dist", "index.js");
const srcDir = join(here, "src");

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

function needsBuild() {
  if (!existsSync(entry)) return "no compiled output found";
  try {
    // A dist older than the sources means someone deployed without rebuilding.
    // Starting that would silently serve the previous release.
    if (newestMtime(srcDir) > statSync(entry).mtimeMs) return "compiled output is older than src/";
  } catch {
    // If the comparison itself fails, trust the existing build rather than
    // rebuilding on every boot.
    return null;
  }
  return null;
}

const reason = needsBuild();
if (reason) {
  console.log(`[prestart] ${reason} — building now.`);
  console.log("[prestart] Set the host's build command to `npm run build` to avoid this at boot.");
  try {
    execSync("npm run build", { cwd: here, stdio: "inherit" });
  } catch {
    // Typically means devDependencies were pruned, so tsc isn't installed.
    console.error(
      "\n[prestart] Build failed. The host's build command must run `npm run build`,\n" +
        "           and devDependencies must be installed when it does.\n"
    );
    process.exit(1);
  }
}
