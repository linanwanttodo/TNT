import fs from "fs";
import path from "path";

import express, { type Express, type Request, type Response } from "express";

import type { WebUiDist } from "./webuiDist.js";
import { missingDistPage } from "./webuiPages.js";

/**
 * The static routes come last: the missing-dist fallback is a catch-all, and
 * registering it first would shadow every API route below it.
 */
export function registerWebUiStaticRoutes(app: Express, dist: WebUiDist): void {
  const { distDir, hasDist } = dist;
  if (hasDist) {
    // index.html names the hashed asset bundle. It must never be cached: an
    // old shell keeps loading old hashes after a redeploy and the new UI
    // looks like dead controls. Hashed assets themselves stay cacheable.
    app.use(
      express.static(distDir, {
        setHeaders: (res, filePath) => {
          if (path.basename(filePath) === "index.html") {
            res.setHeader("Cache-Control", "no-store");
          }
        },
      }),
    );
    // SPA-style fallback: any /app path serves the shell. Express 5 uses
    // path-to-regexp v8, where a bare `*` is invalid and a named wildcard
    // matches one segment at least, so the prefix's own two forms are listed
    // beside it - /app/ is where a reload lands when the build uses /app as
    // its base. A real asset referenced at /app/assets/x.js lives at
    // dist/assets/x.js, so resolve through the prefix before falling back.
    app.get(["/app", "/app/", "/app/*splat"], (req: Request, res: Response) => {
      const relative = req.path.replace(/^\/app\/?/, "/");
      const candidate = path.join(distDir, relative);
      if (
        candidate.startsWith(distDir) &&
        fs.existsSync(candidate) &&
        fs.statSync(candidate).isFile()
      ) {
        res.sendFile(relative, { root: distDir });
        return;
      }
      res.setHeader("Cache-Control", "no-store");
      res.sendFile("index.html", { root: distDir });
    });
  } else {
    // Every path serves the fallback when the dist is missing, so the
    // browser still gets an explanation instead of a 404.
    app.get("*splat", (_req: Request, res: Response) => {
      res.status(200).type("html").send(missingDistPage(dist.searched));
    });
  }
}
