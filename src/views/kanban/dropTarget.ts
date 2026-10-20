/**
 * jKanban drops into boards, not onto cards: an Override dropped "on" its
 * Project card is found from the pointer (or the card landing right next to
 * it) to make it inherit again.
 */
export function isDroppedOnCard(
	el: HTMLElement,
	cardEid: string,
	pointer: { x: number; y: number } | null,
): boolean {
	const isCard = (node: Element | null) => node?.getAttribute("data-eid") === cardEid;
	if (isCard(el.previousElementSibling) || isCard(el.nextElementSibling)) return true;
	if (!pointer) return false;
	return document
		.elementsFromPoint(pointer.x, pointer.y)
		.some((node) => !node.closest(".gu-mirror") && isCard(node.closest(".kanban-item")));
}
