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
		json = null; // not JSON (an image, an HTML error page)
	}
	const contentType = Object.entries(res.headers).find(([k]) => k.toLowerCase() === "content-type")?.[1] ?? "";
	if (!contentType.startsWith("image/")) return { status: res.status, json };
	return { status: res.status, json, arrayBuffer: res.arrayBuffer, contentType };
};
