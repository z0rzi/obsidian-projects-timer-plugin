declare module "jkanban" {
	export interface KanbanItem {
		id?: string;
		title: string;
		class?: string[];
		click?: (el: HTMLElement) => void;
		drag?: (el: HTMLElement, source: HTMLElement) => void;
		dragend?: (el: HTMLElement) => void;
		drop?: (el: HTMLElement, target: HTMLElement, source: HTMLElement, sibling: HTMLElement | null) => void;
	}

	export interface KanbanBoard {
		id: string;
		title: string;
		class?: string;
		bodyClass?: string;
		dragTo?: string[];
		item: KanbanItem[];
	}

	export interface KanbanOptions {
		element: string;
		gutter?: string;
		widthBoard?: string;
		responsivePercentage?: boolean;
		responsive?: string;
		dragItems?: boolean;
		dragBoards?: boolean;
		boards: KanbanBoard[];
		itemAddOptions?: {
			enabled?: boolean;
			content?: string;
			class?: string;
			footer?: boolean;
		};
		itemHandleOptions?: {
			enabled?: boolean;
			handleClass?: string;
			customCssHandler?: string;
			customCssIconHandler?: string;
			customHandler?: string;
		};
		dragEl?: (el: HTMLElement, source: HTMLElement) => void;
		dragendEl?: (el: HTMLElement) => void;
		dropEl?: (el: HTMLElement, target: HTMLElement, source: HTMLElement, sibling: HTMLElement | null) => boolean | void;
		dragBoard?: (el: HTMLElement, source: HTMLElement) => void;
		dragendBoard?: (el: HTMLElement) => void;
		dropBoard?: (el: HTMLElement, target: HTMLElement, source: HTMLElement, sibling: HTMLElement | null) => void;
		click?: (el: HTMLElement) => void;
		buttonClick?: (el: HTMLElement, boardId: string) => void;
	}

	export class jKanban {
		constructor(options: KanbanOptions);
		addElement(boardId: string, element: KanbanItem): jKanban;
		addForm(boardId: string, formElement: HTMLElement): jKanban;
		addBoards(boards: KanbanBoard[], init?: boolean): jKanban;
		findBoard(boardId: string): HTMLElement | null;
		getParentBoardID(elementId: string): string | null;
		moveElement(boardId: string, elementId: string, element: KanbanItem): jKanban;
		replaceElement(elementId: string, element: KanbanItem): jKanban;
		findElement(elementId: string): HTMLElement | null;
		getBoardElements(boardId: string): NodeListOf<ChildNode>;
		removeElement(elementId: string): jKanban;
		removeBoard(boardId: string): jKanban;
		onButtonClick(callback: (el: HTMLElement) => void): void;
	}
}
