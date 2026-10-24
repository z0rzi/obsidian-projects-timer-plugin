import { RemoteError, type Remote } from "./remote";

/** Tries the remote's URL and token; returns the line the settings tab shows under its Test connection button. */
export async function connectionStatus(remote: Remote): Promise<string> {
	try {
		await remote.checkConnection();
		return "Connected";
	} catch (e) {
		if (!(e instanceof RemoteError)) return (e as Error).message;
		if (e.kind === "network") return `Unreachable: ${e.detail}`;
		if (e.status === 401) return "Token rejected";
		if (e.status === 403) return "Not a Developer token";
		return e.message;
	}
}
