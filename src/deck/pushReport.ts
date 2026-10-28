import type { PushOutcome } from "../sync/runPush";

/** The closing Push's result on the report: done, or its failure. */
export interface PushReport {
	tone: "done" | "error";
	text: string;
}

/** The closing Push's result as the report says it; null when nothing was pushed. */
export function pushReport(outcome: PushOutcome | Error | null): PushReport | null {
	if (outcome instanceof Error) return { tone: "error", text: `Push du balayage impossible (${outcome.message}) : lancez le Push.` };
	if (!outcome || (outcome.applied === 0 && outcome.failed.length === 0)) return null;
	const applied = `Balayage poussé vers Suivi : ${outcome.applied} changement${outcome.applied > 1 ? "s" : ""}`;
	if (outcome.failed.length === 0) return { tone: "done", text: applied };
	return { tone: "error", text: `${applied} ; en échec : ${outcome.failed.map((f) => `${f.title} : ${f.error}`).join(" ; ")}` };
}
