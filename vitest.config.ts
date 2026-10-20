import { defineConfig } from "vitest/config";
export default defineConfig({
	resolve: {
		alias: {
			obsidian: new URL("./test/obsidian-stub.ts", import.meta.url).pathname,
			settings: new URL("./src/settings.ts", import.meta.url).pathname,
		},
	},
	test: { include: ["test/**/*.test.ts"] },
});
