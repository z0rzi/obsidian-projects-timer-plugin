import { requestUrl } from "obsidian";
import type { Transport } from "./remote";

/** Transport over Obsidian's `requestUrl` (no CORS limits, works on mobile). */
export const obsidianTransport: Transport = async (req) => {
	const res = await requestUrl({
		url: req.url,
		method: req.method,
		headers: req.headers,
		body: req.body,
		throw: false,
	});
	let json: unknown = null;
	try {
		json = res.json;
	} catch {
		json = null;
	}
	return { status: res.status, json };
};
