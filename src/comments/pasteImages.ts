import { INLINE_IMAGE_TYPES, UPLOAD_MAX_BYTES } from "../remote/api";
import { IMAGE_TYPES } from "../sync/sharedBody";

/** What a textarea gives of its draft: enough to insert at the cursor and swap a placeholder later. */
export interface DraftField {
	value: string;
	selectionStart: number;
	selectionEnd: number;
}

/** A pasted file, as `clipboardData.files` holds them (a `File`). */
export interface PastedFile {
	name: string;
	type: string;
	size: number;
	arrayBuffer(): Promise<ArrayBuffer>;
}

/** Where pasted images go, and how a failure is told. */
export interface PasteUploader {
	/** Uploads one image to the app; its path there (`/uploads/<name>`). */
	upload(data: ArrayBuffer, name: string): Promise<string>;
	report(message: string): void;
}

/** File extension by inline image type: the first one `IMAGE_TYPES` lists (`jpg`, not `jpeg`). */
const EXTENSION = new Map<string, string>();
for (const [ext, type] of Object.entries(IMAGE_TYPES)) if (!EXTENSION.has(type)) EXTENSION.set(type, ext);

/** The images of a paste (PNG, JPEG, GIF, WebP), in order; other files are left out. */
export function imageFiles(files: Iterable<PastedFile> | ArrayLike<PastedFile>): PastedFile[] {
	return Array.from(files).filter((f) => (INLINE_IMAGE_TYPES as readonly string[]).includes(f.type));
}

/** The file's name, given an extension from its type when it has none (a screenshot pasted from the clipboard). */
export function uploadName(file: Pick<PastedFile, "name" | "type">): string {
	const ext = EXTENSION.get(file.type) ?? "png";
	const name = file.name.trim();
	if (!name || name.startsWith(".")) return `image.${ext}`;
	return /\.[A-Za-z0-9]+$/.test(name) ? name : `${name}.${ext}`;
}

function select(field: DraftField, start: number, end: number) {
	// End first: a textarea pulls the other bound along when they'd cross.
	field.selectionEnd = end;
	field.selectionStart = start;
}

/** `snippet` put in place of the selection, the cursor right after it. */
export function insertAtCursor(field: DraftField, snippet: string): void {
	const { value, selectionStart: start, selectionEnd: end } = field;
	field.value = value.slice(0, start) + snippet + value.slice(end);
	select(field, start + snippet.length, start + snippet.length);
}

/**
 * The first `placeholder` of the draft swapped for `replacement`, the cursor
 * staying on the same text; nothing if the placeholder was typed over.
 */
export function replaceInDraft(field: DraftField, placeholder: string, replacement: string): void {
	const at = field.value.indexOf(placeholder);
	if (at < 0) return;
	const { selectionStart: start, selectionEnd: end } = field;
	field.value = field.value.slice(0, at) + replacement + field.value.slice(at + placeholder.length);
	const after = at + placeholder.length;
	const shift = (pos: number) => (pos <= at ? pos : pos >= after ? pos + replacement.length - placeholder.length : at + replacement.length);
	select(field, shift(start), shift(end));
}

/**
 * Images pasted into a comment draft: each gets a placeholder at the cursor at
 * once (numbered by `serial`, so two pastes of the same file stay apart),
 * swapped for its `![](/uploads/…)` once uploaded, or dropped when the upload
 * failed (`report` says why). Resolves, once every image is settled, to
 * whether all of them made it.
 */
export async function uploadPasted(field: DraftField, files: PastedFile[], uploader: PasteUploader, serial: () => number): Promise<boolean> {
	const placeholders = files.map((file) => {
		const placeholder = `![uploading ${uploadName(file)} (${serial()})…]()`;
		insertAtCursor(field, placeholder);
		return placeholder;
	});
	const results = await Promise.all(
		files.map(async (file, i) => {
			const placeholder = placeholders[i]!;
			const name = uploadName(file);
			let url = "";
			try {
				if (file.size > UPLOAD_MAX_BYTES) throw new Error(`${name} is over ${UPLOAD_MAX_BYTES / 1024 / 1024} MB`);
				url = await uploader.upload(await file.arrayBuffer(), name);
			} catch (e) {
				uploader.report(e instanceof Error ? e.message : String(e));
			}
			replaceInDraft(field, placeholder, url ? `![](${url})` : "");
			return url !== "";
		}),
	);
	return results.every(Boolean);
}

/**
 * The image pastes of one draft (Ctrl+V of a screenshot or an image file):
 * `onPaste` takes the images out of the event, uploads them and links them in
 * the draft; a paste without images is left to the browser. `settled()` waits
 * for the uploads in flight, false if one of them failed meanwhile: a Send
 * then neither posts a placeholder nor a comment missing its image.
 */
export function imagePasteHandler(uploader: PasteUploader) {
	let inFlight: Promise<boolean>[] = [];
	let count = 0;
	return {
		onPaste(field: DraftField, e: ClipboardEvent): void {
			const files = imageFiles(e.clipboardData?.files ?? []);
			if (files.length === 0) return;
			e.preventDefault();
			const done: Promise<boolean> = (async () => {
				try {
					return await uploadPasted(field, files, uploader, () => ++count);
				} finally {
					inFlight = inFlight.filter((p) => p !== done);
				}
			})();
			inFlight.push(done);
		},
		async settled(): Promise<boolean> {
			return (await Promise.all(inFlight)).every(Boolean);
		},
	};
}
