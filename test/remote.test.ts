import { describe, expect, it } from "vitest";
import { createHttpRemote, RemoteError, type Transport, type TransportRequest } from "../src/remote/remote";

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

	it("pulls the events after the cursor with a GET, from the start without one", async () => {
		const body = { events: [], cursor: 7 };
		const { sent, transport } = fakeTransport(200, body);
		const remote = createHttpRemote({ url: "https://suivi.test", token: "tok" }, transport);

		expect(await remote.pull(7)).toEqual(body);
		await remote.pull(null);
		expect(sent.map((r) => [r.method, r.url, r.body])).toEqual([
			["GET", "https://suivi.test/api/events?since=7", undefined],
			["GET", "https://suivi.test/api/events?since=0", undefined],
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
