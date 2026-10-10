import fs from "node:fs";
import path from "node:path";
import { buildSeed } from "./seed.js";

/* ------------------------------------------------------------------
   Physical layer: one JSON file on the laptop running the server.

   Node handles one request at a time, so every check-in reads and
   writes the data without interleaving. Two gates scanning the same
   ticket at the same moment cannot both admit it.

   Writes go to a temporary file first and are then renamed over the
   real one, so a crash mid-write never leaves a half-written file.
------------------------------------------------------------------- */

export function openStore(file) {
  const dataFile = path.resolve(file);
  let data;

  if (fs.existsSync(dataFile)) {
    data = JSON.parse(fs.readFileSync(dataFile, "utf8"));
  } else {
    data = buildSeed(new Date());
    fs.mkdirSync(path.dirname(dataFile), { recursive: true });
    write();
  }
  data.rev = data.rev || 1;

  function write() {
    const tmp = `${dataFile}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(data));
    fs.renameSync(tmp, dataFile);
  }

  return {
    file: dataFile,
    get data() { return data; },
    /** Apply a change, bump the revision, persist. Returns whatever fn returns. */
    mutate(fn) {
      const out = fn(data);
      data.rev += 1;
      write();
      return out;
    },
  };
}
