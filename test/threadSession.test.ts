import { describe, expect, it } from "vitest";
import { ThreadSession, type ThreadState } from "../src/comments/threadSession";
import type { Comment } from "../src/remote/api";
import { RemoteError, type Remote } from "../src/remote/remote";

const task = { kind: "task", id: "t7f3a", title: "Fix heatmap" } as const;
const project = { kind: "project", id: "p1abc", title: "Widget" } as const;

function comment(id: string, body: string, mine = false): Comment {
	return {
		id,
		item_id: "t7f3a",
		author_id: mine ? "dev" : "jmj",
		author_email: mine ? "dev@mbz-dev.com" : "jmj@edf.fr",
		author_role: mine ? "developer" : "client",
		body,
		created_at: "2026-10-20T10:00:00.000Z",
		edited_at: null,
		mine,
	};
}

/** In-memory app: threads by item id, calls recorded. */
function fakeRemote(threads: Record<string, Comment[]>) {
	const calls: string[] = [];
	const pending: (() => void)[] = [];
	let hold = false;
	const later = <T>(value: () => T) =>
		new Promise<T>((resolve, reject) => {
			const run = () => {
				try {
					resolve(value());
				} catch (e) {
					reject(e);
				}
			};
			if (hold) pending.push(run);
			else run();
		});
	let n = 0;
	const remote: Remote = {
		push: async () => [],
		pull: async () => ({ events: [], cursor: 0 }),
		comments: (id) => {
			calls.push(`comments ${id}`);
			return later(() => {
				if (!threads[id]) throw new RemoteError("server", "Suivi error (HTTP 404): Élément introuvable");
				return [...threads[id]!];
			});
		},
		comment: async (id, body) => {
			calls.push(`comment ${id} ${body}`);
			const c = { ...comment(`c${++n}`, body, true), item_id: id };
			threads[id]!.push(c);
			return c;
		},
		editComment: async (id, body) => {
			calls.push(`edit ${id} ${body}`);
			for (const list of Object.values(threads)) {
				const i = list.findIndex((c) => c.id === id);
				if (i < 0) continue;
				if (body === null) list.splice(i, 1);
				else list[i] = { ...list[i]!, body, edited_at: "2026-10-20T11:00:00.000Z" };
			}
		},
	};
	return {
		remote,
		calls,
		threads,
		hold: () => (hold = true),
		release: () => {
			hold = false;
			pending.splice(0).forEach((run) => run());
		},
	};
}

function session(threads: Record<string, Comment[]>) {
	const fake = fakeRemote(threads);
	const states: ThreadState[] = [];
	const s = new ThreadSession(fake.remote, (state) => states.push(state));
	return { ...fake, s, last: () => states.at(-1)! };
}

describe("comment panel thread", () => {
	it("loads the thread of the item under the cursor", async () => {
		const w = session({ t7f3a: [comment("c0", "Une question")] });
		await w.s.show(task);
		expect(w.last()).toMatchObject({ target: task, status: "ready" });
		expect(w.last().comments.map((c) => c.body)).toEqual(["Une question"]);
	});

	it("doesn't reload when the cursor stays on the same item", async () => {
		const w = session({ t7f3a: [] });
		await w.s.show(task);
		await w.s.show({ ...task });
		expect(w.calls).toEqual(["comments t7f3a"]);
	});

	it("keeps only the latest item when the cursor moves before a thread arrives", async () => {
		const w = session({ t7f3a: [comment("c0", "De la tâche")], p1abc: [comment("c1", "Du projet")] });
		w.hold();
		const first = w.s.show(task);
		const second = w.s.show(project);
		w.release();
		await Promise.all([first, second]);
		expect(w.last()).toMatchObject({ target: project, status: "ready" });
		expect(w.last().comments.map((c) => c.body)).toEqual(["Du projet"]);
	});

	it("shows nothing off pushed items, and the app's message when a thread can't load", async () => {
		const w = session({});
		await w.s.show(null);
		expect(w.last()).toMatchObject({ target: null, status: "idle", comments: [] });
		await w.s.show(task);
		expect(w.last()).toMatchObject({ status: "error", error: expect.stringMatching(/introuvable/) });
	});

	it("replies, edits and deletes, then shows the thread as the app has it", async () => {
		const w = session({ t7f3a: [comment("c0", "Une question")] });
		await w.s.show(task);
		expect(await w.s.reply("  Une réponse  ")).toBe(true);
		expect(w.calls).toContain("comment t7f3a Une réponse");
		const mine = w.last().comments.find((c) => c.mine)!;
		expect(mine.body).toBe("Une réponse");

		await w.s.edit(mine.id, "Réponse corrigée");
		expect(w.last().comments.find((c) => c.id === mine.id)).toMatchObject({ body: "Réponse corrigée" });
		expect(w.last().comments.find((c) => c.id === mine.id)!.edited_at).not.toBeNull();

		await w.s.remove(mine.id);
		expect(w.last().comments.map((c) => c.body)).toEqual(["Une question"]);
	});

	it("refuses empty replies and keeps the thread when sending fails", async () => {
		const w = session({ t7f3a: [comment("c0", "Une question")] });
		await w.s.show(task);
		expect(await w.s.reply("   ")).toBe(false);
		w.remote.comment = async () => {
			throw new RemoteError("network", "Suivi unreachable");
		};
		expect(await w.s.reply("Bonjour")).toBe(false);
		expect(w.last()).toMatchObject({ status: "ready", error: "Suivi unreachable" });
		expect(w.last().comments).toHaveLength(1);
	});
});
