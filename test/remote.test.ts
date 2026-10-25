import { describe, expect, it } from "vitest";
import { createHttpRemote, RemoteError, type Transport, type TransportRequest } from "../src/remote/remote";
import { connectionStatus } from "../src/remote/connectionStatus";

function fakeTransport(status: number, body: unknown) {
	const sent: TransportRequest[] = [];
	const transport: Transport = async (req) => {
		sent.push(req);
		return { status, json: body };
	};
	return { sent, transport };
}

const change = { op: "archive", kind: "project", id: "t7f3a" } as const;

describe("HTTP remote", () => {
	it("posts the changes to /api/push with the bearer token and returns the results", async () => {
		const { sent, transport } = fakeTransport(200, { results: [{ ok: true, id: "t7f3a" }] });
		const remote = createHttpRemote({ url: "https://suivi.test/", token: "tok" }, transport);

		expect(await remote.push([change])).toEqual([{ ok: true, id: "t7f3a" }]);
		expect(sent).toEqual([
			{
				url: "https://suivi.test/api/push",
				method: "POST",
				headers: { Authorization: "Bearer tok", "Content-Type": "application/json" },
				body: JSON.stringify({ changes: [change] }),
			},
		]);
	});

	it("gets the state and posts acknowledged bases", async () => {
		const items = [{ id: "t7f3a", kind: "task", base: null, archived: false, triaged: true, answer: null }];
		const { sent, transport } = fakeTransport(200, { items, ok: true });
		const remote = createHttpRemote({ url: "https://suivi.test", token: "tok" }, transport);

		expect(await remote.state()).toEqual(items);
		await remote.acknowledge([{ id: "t7f3a", base: { path: "m.md" } }]);
		expect(sent.map((r) => [r.method, r.url, r.body])).toEqual([
			["GET", "https://suivi.test/api/state", undefined],
			["POST", "https://suivi.test/api/state/acknowledge", JSON.stringify({ items: [{ id: "t7f3a", base: { path: "m.md" } }] })],
		]);
	});

	it("turns a rejected token into a clear auth error", async () => {
		for (const status of [401, 403]) {
			const remote = createHttpRemote(
				{ url: "https://suivi.test", token: "bad" },
				fakeTransport(status, { error: "Jeton API manquant, inconnu ou révoqué" }).transport,
			);
			const err = await remote.push([change]).catch((e: unknown) => e);

			expect(err).toBeInstanceOf(RemoteError);
			expect(err).toMatchObject({ kind: "auth" });
			expect((err as Error).message).toMatch(/jeton/i);
		}
	});

	it("reports an unreachable app and a server error distinctly", async () => {
		const down = createHttpRemote({ url: "https://suivi.test", token: "t" }, async () => {
			throw new Error("ECONNREFUSED");
		});
		await expect(down.push([change])).rejects.toMatchObject({ kind: "network" });

		const broken = createHttpRemote({ url: "https://suivi.test", token: "t" }, fakeTransport(500, null).transport);
		await expect(broken.push([change])).rejects.toMatchObject({ kind: "server" });
	});

	it("refuses to call without an app URL or token", async () => {
		const { sent, transport } = fakeTransport(200, { results: [] });
		const remote = createHttpRemote({ url: "", token: "" }, transport);

		await expect(remote.push([change])).rejects.toMatchObject({ kind: "config" });
		expect(sent).toEqual([]);
	});
});

describe("HTTP remote, comments", () => {
	const comment = {
		id: "cabc1234",
		item_id: "t7f3a",
		author_id: "u1",
		author_email: "jmj@edf.fr",
		author_role: "client",
		body: "Une question",
		created_at: "2026-10-20T10:00:00.000Z",
		edited_at: null,
		mine: false,
	} as const;
	const remoteWith = (transport: Transport) => createHttpRemote({ url: "https://suivi.test", token: "tok" }, transport);

	it("reads the thread of an item", async () => {
		const { sent, transport } = fakeTransport(200, { comments: [comment] });
		expect(await remoteWith(transport).comments("t7f3a")).toEqual([comment]);
		expect(sent[0]).toMatchObject({ url: "https://suivi.test/api/items/t7f3a/comments", method: "GET" });
		expect(sent[0]!.body).toBeUndefined();
	});

	it("posts a reply and returns the new comment", async () => {
		const mine = { ...comment, id: "cdef5678", body: "Une réponse", mine: true };
		const { sent, transport } = fakeTransport(201, { comment: mine });
		expect(await remoteWith(transport).comment("t7f3a", "Une réponse")).toEqual(mine);
		expect(sent[0]).toMatchObject({
			url: "https://suivi.test/api/items/t7f3a/comments",
			method: "POST",
			body: JSON.stringify({ body: "Une réponse" }),
		});
	});

	it("changes a comment with PATCH, and removes it with DELETE when the body is null", async () => {
		const changed = { ...comment, body: "Corrigé", edited_at: "2026-10-20T11:00:00.000Z", mine: true };
		const patch = fakeTransport(200, { comment: changed });
		await remoteWith(patch.transport).editComment("cabc1234", "Corrigé");
		expect(patch.sent[0]).toMatchObject({
			url: "https://suivi.test/api/comments/cabc1234",
			method: "PATCH",
			body: JSON.stringify({ body: "Corrigé" }),
		});

		const del = fakeTransport(200, { ok: true });
		await remoteWith(del.transport).editComment("cabc1234", null);
		expect(del.sent[0]).toMatchObject({ url: "https://suivi.test/api/comments/cabc1234", method: "DELETE" });
	});

	it("passes the app's message on for an unknown item", async () => {
		const remote = remoteWith(fakeTransport(404, { error: "Élément introuvable" }).transport);
		await expect(remote.comments("zzzzz")).rejects.toMatchObject({
			kind: "server",
			message: expect.stringMatching(/introuvable/),
		});
	});
});

describe("HTTP remote, inbox", () => {
	const remoteWith = (transport: Transport) => createHttpRemote({ url: "https://suivi.test", token: "tok" }, transport);

	it("reads the unread Notifications", async () => {
		const body = { notifications: [{ id: 4, type: "comment.created", item_id: "t7f3a" }] };
		const { sent, transport } = fakeTransport(200, body);
		expect(await remoteWith(transport).inbox()).toEqual(body);
		expect(sent[0]).toMatchObject({ url: "https://suivi.test/api/inbox", method: "GET" });
	});

	it("marks events read with a POST of their ids", async () => {
		const { sent, transport } = fakeTransport(200, { ok: true });
		await remoteWith(transport).markRead([4, 7]);
		expect(sent[0]).toMatchObject({
			url: "https://suivi.test/api/events/read",
			method: "POST",
			body: JSON.stringify({ ids: [4, 7] }),
		});
	});

	it("reads a page of the Activity feed, older than an event and over some days", async () => {
		const body = { entries: [{ id: 9, label: "Commentaire" }], next: 9 };
		const { sent, transport } = fakeTransport(200, body);
		const remote = remoteWith(transport);
		expect(await remote.activity()).toEqual(body);
		await remote.activity(9, 7);
		expect(sent.map((r) => [r.method, r.url])).toEqual([
			["GET", "https://suivi.test/api/activity"],
			["GET", "https://suivi.test/api/activity?before=9&days=7"],
		]);
	});

	it("marks every Client event up to an id read", async () => {
		const { sent, transport } = fakeTransport(200, { ok: true });
		await remoteWith(transport).markReadUpTo(12);
		expect(sent[0]).toMatchObject({
			url: "https://suivi.test/api/events/read",
			method: "POST",
			body: JSON.stringify({ upto: 12 }),
		});
	});

	it("uploads an image as multipart field `file` and returns its URL", async () => {
		const { sent, transport } = fakeTransport(200, { url: "/uploads/abc.png" });
		const png = new Uint8Array([137, 80, 78, 71]).buffer;
		expect(await remoteWith(transport).upload(png, "capture 1.png")).toBe("/uploads/abc.png");
		const req = sent[0]!;
		expect(req).toMatchObject({ url: "https://suivi.test/api/uploads", method: "POST" });
		const type = req.headers["Content-Type"]!;
		const boundary = type.match(/^multipart\/form-data; boundary=(.+)$/)?.[1];
		expect(boundary).toBeTruthy();
		// Parse it back as a server would.
		const form = await new Response(req.body as ArrayBuffer, { headers: { "content-type": type } }).formData();
		const file = form.get("file") as File;
		expect(file.name).toBe("capture 1.png");
		expect(file.type).toBe("image/png");
		expect([...new Uint8Array(await file.arrayBuffer())]).toEqual([137, 80, 78, 71]);
	});

	it("fetches an uploaded image with the bearer token (uploads are not public)", async () => {
		const png = new Uint8Array([137, 80, 78, 71]).buffer;
		const sent: TransportRequest[] = [];
		const transport: Transport = async (req) => {
			sent.push(req);
			return { status: 200, json: null, arrayBuffer: png, contentType: "image/png" };
		};
		expect(await remoteWith(transport).image("/uploads/abc.png")).toEqual({ data: png, type: "image/png" });
		expect(sent[0]).toMatchObject({
			url: "https://suivi.test/api/uploads/abc.png",
			method: "GET",
			headers: { Authorization: "Bearer tok" },
		});
	});

	it("refuses anything but an upload path, and reports a missing image", async () => {
		const { sent, transport } = fakeTransport(404, { error: "Introuvable" });
		await expect(remoteWith(transport).image("/parametres")).rejects.toThrow();
		await expect(remoteWith(transport).image("/uploads/../x")).rejects.toThrow();
		expect(sent).toEqual([]);
		await expect(remoteWith(transport).image("/uploads/gone.png")).rejects.toMatchObject({ kind: "server" });
	});
});

describe("HTTP remote, triage", () => {
	it("posts the target to /api/items/:id/triage and returns the Task's fields", async () => {
		const fields = { title: "Heatmap vide", type: "bug", priority: 2, done: false, project_id: null };
		const { sent, transport } = fakeTransport(200, { id: "t7f3a", fields });
		const remote = createHttpRemote({ url: "https://suivi.test", token: "tok" }, transport);
		const as = { as: "task", type: "bug", priority: 2, project_id: null } as const;

		expect(await remote.triage("t7f3a", as)).toEqual({ id: "t7f3a", fields });
		expect(sent[0]).toMatchObject({
			url: "https://suivi.test/api/items/t7f3a/triage",
			method: "POST",
			body: JSON.stringify(as),
		});
	});
});

describe("HTTP remote, connection test", () => {
	it("gets an empty page of events, past every event id", async () => {
		const { sent, transport } = fakeTransport(200, { events: [], cursor: Number.MAX_SAFE_INTEGER });
		await createHttpRemote({ url: "https://suivi.test", token: "tok" }, transport).checkConnection();

		expect(sent[0]).toMatchObject({ url: `https://suivi.test/api/events?since=${Number.MAX_SAFE_INTEGER}`, method: "GET" });
	});

	it("tells what is wrong with the URL or the token", async () => {
		const status = (url: string, transport: Transport) =>
			connectionStatus(createHttpRemote({ url, token: "tok" }, transport));
		const answering = (code: number, error?: string) => fakeTransport(code, error ? { error } : null).transport;
		const events = fakeTransport(200, { events: [], cursor: 0 }).transport;

		expect(await status("https://suivi.test", events)).toBe("Connected");
		expect(await status("https://suivi.test", answering(200))).toBe("Suivi error (HTTP 200): not JSON");
		expect(await status("https://suivi.test", answering(401, "Jeton révoqué"))).toBe("Token rejected");
		expect(await status("https://suivi.test", answering(403, "Réservé aux Développeurs"))).toBe("Not a Developer token");
		expect(await status("https://suivi.test", answering(500, "Boom"))).toBe("Suivi error (HTTP 500): Boom");
		expect(await status("", events)).toBe("Suivi: set the app URL and API token in the plugin settings.");
		expect(
			await status("suivi", async () => {
				throw new Error("Invalid URL");
			}),
		).toBe("Unreachable: Invalid URL");
	});
});
