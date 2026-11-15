// A stand-in for the review worker: reports its pid and stays alive until it
// is told to stop, so a test can prove the parent actually stops it.
import { writeFileSync } from "node:fs";

const pidFile = process.argv[2];
if (pidFile) {
  writeFileSync(pidFile, String(process.pid));
}

setInterval(() => {}, 1000);
