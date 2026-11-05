import fs from "fs";
import path from "path";

/**
 * Where a built frontend may live, in the order the server should trust it.
 *
 * The frontend is not a published package: tnt-webui is private, and its build
 * is copied to dist/webui at CLI build time because the release tarball
 * publishes dist/ alone. A source checkout keeps the vite output at webui/dist
 * instead, and the last entry is the historical hand-installed location, which
 * still serves anyone who set it up that way.
 */
export function webuiDistCandidates(
  moduleDir: string,
  cwd = process.cwd(),
): string[] {
  const packageRoot = findPackageRoot(moduleDir);
  return [
    path.join(packageRoot, "dist", "webui"),
    path.join(packageRoot, "webui", "dist"),
    path.resolve(cwd, "node_modules", "tnt-webui", "dist"),
  ];
}

export interface WebUiDist {
  /** The directory to serve: the first candidate that exists. */
  distDir: string;
  /** Every place looked, for the page that explains a miss. */
  searched: string[];
  hasDist: boolean;
}

/**
 * Resolve the frontend directory. An explicit value - the option or the env
 * override - is honoured on its own and never weighed against the fallbacks,
 * so a mis-set override reports the path the operator actually wrote.
 */
export function resolveWebUiDist(
  moduleDir: string,
  configured?: string,
  cwd = process.cwd(),
): WebUiDist {
  if (configured !== undefined && configured !== "") {
    const distDir = path.resolve(cwd, configured);
    return { distDir, searched: [distDir], hasDist: fs.existsSync(distDir) };
  }
  const searched = webuiDistCandidates(moduleDir, cwd);
  const found = searched.find((candidate) => fs.existsSync(candidate));
  return {
    distDir: found ?? searched[0],
    searched,
    hasDist: found !== undefined,
  };
}

/**
 * The nearest directory holding a package.json. The bundle runs from dist and
 * the sources from src/services, so the package root is walked for rather than
 * assumed from a fixed number of levels.
 */
function findPackageRoot(from: string): string {
  let dir = from;
  for (;;) {
    if (fs.existsSync(path.join(dir, "package.json"))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return from;
    dir = parent;
  }
}
