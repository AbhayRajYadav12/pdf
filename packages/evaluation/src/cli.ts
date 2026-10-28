import { writeEvaluationReport } from "./fixture.js";

const destination = await writeEvaluationReport();
console.log(`Wrote ${destination}`);
