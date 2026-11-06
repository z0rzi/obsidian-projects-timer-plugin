import { describe, expect, it } from "vitest";
import { imageFiles, insertAtCursor, replaceInDraft, uploadName, uploadPasted, type DraftField, type PastedFile } from "../src/comments/pasteImages";
import { UPLOAD_MAX_BYTES } from "../src/remote/api";

const draft = (value: string, start = value.length, end = start): DraftField => ({ value, selectionStart: start, selectionEnd: end });

function file(name: string, type = "image/png", size = 3): PastedFile {
	return { name, type, size, arrayBuffer: async () => new Uint8Array(size).buffer };
}

let n = 0;
const serial = () => ++n;

describe("pasted images", () => {
	it("keeps the PNG, JPEG, GIF and WebP files of a paste, in order", () => {
		const files = [file("a.png"), file("doc.pdf", "application/pdf"), file("b.jpg", "image/jpeg"), file("c.svg", "image/svg+xml"), file("d.webp", "image/webp")];
		expect(imageFiles(files).map((f) => f.name)).toEqual(["a.png", "b.jpg", "d.webp"]);
	});

	it("names a clipboard screenshot from its type when the browser gave none", () => {
		expect(uploadName({ name: "", type: "image/jpeg" })).toBe("image.jpg");
		expect(uploadName({ name: "image.png", type: "image/png" })).toBe("image.png");
		expect(uploadName({ name: "shot", type: "image/webp" })).toBe("shot.webp");
	});
});

describe("draft edits", () => {
	it("inserts over the selection and leaves the cursor after the snippet", () => {
		const d = draft("see  here", 4, 4);
		insertAtCursor(d, "![](x)");
		expect(d.value).toBe("see ![](x) here");
		expect([d.selectionStart, d.selectionEnd]).toEqual([10, 10]);
		const sel = draft("drop THIS now", 5, 9);
		insertAtCursor(sel, "![](y)");
		expect(sel.value).toBe("drop ![](y) now");
	});

	it("swaps a placeholder and keeps the cursor on the text it was on", () => {
		const d = draft("a [P] b", 7, 7);
		replaceInDraft(d, "[P]", "![](/uploads/z.png)");
		expect(d.value).toBe("a ![](/uploads/z.png) b");
		expect(d.selectionStart).toBe(23);
		const before = draft("[P] tail", 0, 0);
		replaceInDraft(before, "[P]", "");
		expect(before.value).toBe(" tail");
		expect(before.selectionStart).toBe(0);
		const gone = draft("typed over", 3, 3);
		replaceInDraft(gone, "[P]", "x");
		expect(gone.value).toBe("typed over");
	});
});

describe("uploadPasted", () => {
	it("puts a numbered placeholder at once, then the uploaded image's link, in the paste order", async () => {
		const d = draft("Look: ");
		const resolvers: ((url: string) => void)[] = [];
		const upload = (_data: ArrayBuffer, name: string) => new Promise<string>((resolve) => resolvers.push((url) => resolve(url + name)));
		const done = uploadPasted(d, [file("a.png"), file("a.png")], { upload, report: () => {} }, serial);
		expect(d.value).toMatch(/^Look: !\[uploading a\.png \((\d+)\)…\]\(\)!\[uploading a\.png \((\d+)\)…\]\(\)$/);
		const [first, second] = [...d.value.matchAll(/\((\d+)\)/g)].map((m) => m[1]);
		expect(first).not.toBe(second);
		await new Promise((r) => setTimeout(r));
		resolvers[1]!("/uploads/second-");
		resolvers[0]!("/uploads/first-");
		expect(await done).toBe(true);
		expect(d.value).toBe("Look: ![](/uploads/first-a.png)![](/uploads/second-a.png)");
	});

	it("drops the placeholder, reports and answers false when the upload fails or the file is too big", async () => {
		const d = draft("");
		const errors: string[] = [];
		const upload = async () => {
			throw new Error("Suivi error (HTTP 507)");
		};
		const ok = await uploadPasted(d, [file("a.png"), file("huge.png", "image/png", UPLOAD_MAX_BYTES + 1)], { upload, report: (m) => errors.push(m) }, serial);
		expect(ok).toBe(false);
		expect(d.value).toBe("");
		expect(errors.sort()).toEqual(["Suivi error (HTTP 507)", "huge.png is over 25 MB"]);
	});
});
