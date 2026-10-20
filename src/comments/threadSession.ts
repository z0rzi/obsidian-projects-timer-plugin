import type { Comment } from "../remote/api";
import type { Remote } from "../remote/remote";
import type { CommentTarget } from "./commentTarget";

export interface ThreadState {
	/** Item whose thread is shown; null when the cursor isn't on a pushed item. */
	target: CommentTarget | null;
	status: "idle" | "loading" | "ready" | "error";
	comments: Comment[];
	/** Last failure, ready for display (loading or sending). */
	error?: string;
}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

/**
 * What the comment side panel shows: the thread of one item, kept in sync
 * with the app after each reply, edit or delete. Rendering is the view's job.
 */
export class ThreadSession {
	private state: ThreadState = { target: null, status: "idle", comments: [] };
	/** Bumped on every load so a late answer for a previous item is dropped. */
	private generation = 0;

	constructor(
		private readonly remote: Remote,
		private readonly onChange: (state: ThreadState) => void,
	) {}

	get current(): ThreadState {
		return this.state;
	}

	/** Shows `target`'s thread; nothing happens if it is already shown, even after an error (use `reload`). */
	async show(target: CommentTarget | null): Promise<void> {
		const same = target
			? target.id === this.state.target?.id
			: this.state.target === null && this.state.status === "idle" && this.generation > 0;
		if (same) return;
		if (!target) {
			this.generation++;
			this.set({ target: null, status: "idle", comments: [] });
			return;
		}
		this.set({ target, status: "loading", comments: [] });
		await this.reload();
	}

	/** Fetches the shown thread again. */
	async reload(): Promise<void> {
		const target = this.state.target;
		if (!target) return;
		const generation = ++this.generation;
		try {
			const comments = await this.remote.comments(target.id);
			if (generation === this.generation) this.set({ target, status: "ready", comments });
		} catch (e) {
			if (generation === this.generation) this.set({ target, status: "error", comments: [], error: message(e) });
		}
	}

	/** Posts a reply on the shown item. False if empty or it failed (see `error`). */
	async reply(body: string): Promise<boolean> {
		const text = body.trim();
		const target = this.state.target;
		if (!text || !target) return false;
		return this.send(() => this.remote.comment(target.id, text));
	}

	async edit(commentId: string, body: string): Promise<boolean> {
		const text = body.trim();
		if (!text) return false;
		return this.send(() => this.remote.editComment(commentId, text));
	}

	async remove(commentId: string): Promise<boolean> {
		return this.send(() => this.remote.editComment(commentId, null));
	}

	/** Runs a change, then reloads so the thread shows the app's truth (others may have written meanwhile). */
	private async send(change: () => Promise<unknown>): Promise<boolean> {
		try {
			await change();
		} catch (e) {
			this.set({ ...this.state, error: message(e) });
			return false;
		}
		await this.reload();
		return true;
	}

	private set(state: ThreadState) {
		this.state = state;
		this.onChange(state);
	}
}
