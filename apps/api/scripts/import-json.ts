/**
 * One-time import of the old JSON data file into SQLite. Copies courses,
 * assignments, students, answers, sessions and push records the database
 * does not already have. Usage:
 *   pnpm --filter @gg/api import-json [path/to/ghost-grader.json]
 */
import "dotenv/config";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { JsonStore } from "../src/json-store";
import { Store } from "../src/store";

const here = dirname(fileURLToPath(import.meta.url));
const jsonPath = process.argv[2] ?? join(here, "../data/ghost-grader.json");
const dbPath = process.env.GG_DB_PATH ?? join(here, "../data/ghost-grader.sqlite");

if (!existsSync(jsonPath)) {
  console.log(`Nothing to import: ${jsonPath} does not exist.`);
  process.exit(0);
}

const json = new JsonStore(jsonPath);
const store = new Store(dbPath);
const n = { courses: 0, assignments: 0, students: 0, answers: 0, decisions: 0, pushes: 0 };

for (const t of json.teachers()) {
  for (const c of json.coursesFor(t.id)) {
    if (store.course(t.id, c.id)) continue;
    store.db.insert((await import("../src/db/schema")).courses).values(c).run();
    n.courses++;
  }
  for (const a of json.assignmentsFor(t.id)) {
    if (!store.assignment(t.id, a.id)) {
      store.createAssignment(a);
      n.assignments++;
    }
    for (const ans of json.answersFor(a.id)) {
      if (!store.student(ans.studentId)) {
        const s = json.student(ans.studentId) ?? { id: ans.studentId, name: ans.studentName, lmsStudentId: "" };
        store.upsertStudent(s);
        n.students++;
      }
      if (store.answer(a.id, ans.id)) continue;
      store.upsertAnswer(ans);
      n.answers++;
    }
    const session = json.session(a.id);
    if (store.session(a.id).decisions.length === 0 && session.decisions.length > 0) {
      store.saveSession(a.id, session);
      n.decisions += session.decisions.length;
    }
    const pushes = json.pushesFor(a.id);
    if (store.pushesFor(a.id).length === 0 && pushes.length > 0) {
      store.savePushes(a.id, pushes);
      n.pushes += pushes.length;
    }
  }
}
console.log(`Imported into ${dbPath}: ${Object.entries(n).map(([k, v]) => `${v} ${k}`).join(", ")}`);
store.close();
