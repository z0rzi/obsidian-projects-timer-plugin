import { defineConfig } from "vitest/config";

// Dates written to the vault are local days: tests pin a zone ahead of UTC.
process.env.TZ = "Europe/Paris";

export default defineConfig({
	resolve: {
		alias: {
			obsidian: new URL("./test/obsidian-stub.ts", import.meta.url).pathname,
			settings: new URL("./src/settings.ts", import.meta.url).pathname,
		},
	},
	test: { include: ["test/**/*.test.ts"] },
});
