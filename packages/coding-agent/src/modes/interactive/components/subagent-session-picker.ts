import {
	type Component,
	Container,
	type Focusable,
	fuzzyFilter,
	getEditorKeybindings,
	Input,
	Spacer,
	Text,
	truncateToWidth,
} from "@mariozechner/pi-tui";
import type { SubagentActivity, SubagentSnapshot, SubagentStatus } from "../../../core/subagents.js";
import { theme } from "../theme/theme.js";
import { DynamicBorder } from "./dynamic-border.js";
import { keyHint } from "./keybinding-hints.js";

interface SubagentRow {
	snapshot: SubagentSnapshot;
	title: string;
	meta: string;
	searchText: string;
}

const MAX_VISIBLE_SUBAGENTS = 10;

function compactWhitespace(text: string | undefined): string {
	return (text ?? "").replace(/\s+/g, " ").trim();
}

function preview(text: string | undefined, maxLength = 52): string {
	const normalized = compactWhitespace(text);
	if (!normalized) return "";
	return normalized.length > maxLength ? `${normalized.slice(0, maxLength - 1)}…` : normalized;
}

function isGeneratedSubagentName(subagent: SubagentSnapshot, name: string): boolean {
	return name === `subagent-${subagent.id}`;
}

function formatActivityHint(activity: SubagentActivity | undefined): string {
	if (!activity) return "";
	const text = preview(activity.text);
	if (!text) return "";
	switch (activity.kind) {
		case "assistant":
			return `Reply: ${text}`;
		case "tool":
			return `Using ${text}`;
		case "user":
			return `Queued: ${text}`;
		case "error":
			return `Error: ${text}`;
		default:
			return text;
	}
}

export function formatSubagentSessionName(subagent: SubagentSnapshot): string {
	const normalized = compactWhitespace(subagent.name);
	if (!normalized || isGeneratedSubagentName(subagent, normalized)) {
		return `Sibling session ${subagent.id}`;
	}
	return normalized;
}

export function formatSubagentStatus(status: SubagentStatus): string {
	switch (status) {
		case "running":
			return "running";
		case "completed":
			return "completed";
		case "failed":
			return "failed";
		case "cancelled":
			return "cancelled";
		default:
			return status;
	}
}

export function formatSubagentActivityHint(subagent: SubagentSnapshot): string {
	if (subagent.currentTool) {
		return `Using ${preview(subagent.currentTool)}`;
	}
	const lastActivity = subagent.activity.at(-1);
	if (lastActivity && lastActivity.kind !== "status") {
		const activityHint = formatActivityHint(lastActivity);
		if (activityHint) return activityHint;
	}
	if (subagent.latestAssistantText) {
		return `Reply: ${preview(subagent.latestAssistantText)}`;
	}
	if (subagent.lastError) {
		return `Error: ${preview(subagent.lastError)}`;
	}
	const activityHint = formatActivityHint(lastActivity);
	if (activityHint) return activityHint;
	if (subagent.prompt) {
		return `Started from ${preview(subagent.prompt)}`;
	}
	return "No recent activity";
}

export function buildSubagentPickerRow(subagent: SubagentSnapshot): SubagentRow {
	const sessionName = formatSubagentSessionName(subagent);
	const title = sessionName.startsWith("Sibling session ") ? sessionName : `${sessionName} (${subagent.id})`;
	const meta = [
		formatSubagentStatus(subagent.status),
		subagent.model ?? "current model",
		formatSubagentActivityHint(subagent),
	]
		.filter(Boolean)
		.join(" • ");
	const searchText = [
		subagent.id,
		subagent.name,
		subagent.model,
		subagent.prompt,
		subagent.currentTool,
		subagent.latestAssistantText,
		subagent.lastError,
		subagent.activity.map((item) => item.text).join(" "),
	]
		.filter(Boolean)
		.join(" ");
	return {
		snapshot: subagent,
		title,
		meta,
		searchText,
	};
}

export function formatSubagentSelectionAcknowledgement(subagent: SubagentSnapshot): string {
	return `Selected sibling session "${formatSubagentSessionName(subagent)}" (${subagent.id}). Staying in the current view for now.`;
}

class SubagentSessionList implements Component {
	constructor(
		private readonly getRows: () => readonly SubagentRow[],
		private readonly getSelectedIndex: () => number,
		private readonly getQuery: () => string,
	) {}

	invalidate(): void {}

	render(width: number): string[] {
		const rows = this.getRows();
		if (rows.length === 0) {
			const message = this.getQuery().trim() ? "  No matching sibling sessions" : "  No sibling sessions yet";
			return [theme.fg("muted", truncateToWidth(message, width, "…"))];
		}

		const selectedIndex = this.getSelectedIndex();
		const startIndex = Math.max(
			0,
			Math.min(selectedIndex - Math.floor(MAX_VISIBLE_SUBAGENTS / 2), rows.length - MAX_VISIBLE_SUBAGENTS),
		);
		const endIndex = Math.min(startIndex + MAX_VISIBLE_SUBAGENTS, rows.length);
		const lines: string[] = [];

		for (let i = startIndex; i < endIndex; i++) {
			const row = rows[i];
			if (!row) continue;
			const isSelected = i === selectedIndex;
			const cursor = isSelected ? theme.fg("accent", "› ") : "  ";
			const title = isSelected ? theme.bold(theme.fg("accent", row.title)) : theme.fg("text", row.title);
			const meta = theme.fg("muted", row.meta);
			lines.push(truncateToWidth(`${cursor}${title}  ${meta}`, width, "…"));
		}

		if (startIndex > 0 || endIndex < rows.length) {
			lines.push(theme.fg("muted", truncateToWidth(`  (${selectedIndex + 1}/${rows.length})`, width, "")));
		}

		return lines;
	}
}

export class SubagentSessionPickerComponent extends Container implements Focusable {
	private readonly searchInput: Input;
	private readonly subagentList: SubagentSessionList;
	private filteredRows: SubagentRow[] = [];
	private selectedIndex = 0;
	private _focused = false;

	constructor(
		private readonly getSubagents: () => SubagentSnapshot[],
		private readonly onSelect: (subagent: SubagentSnapshot) => void,
		private readonly onCancel: () => void,
	) {
		super();

		this.addChild(new Spacer(1));
		this.addChild(new Text(theme.bold("Sibling Sessions"), 1, 0));
		this.addChild(new Text(theme.fg("muted", "Choose a sibling session to jump to next"), 1, 0));
		this.addChild(
			new Text(
				theme.fg(
					"muted",
					`${keyHint("selectConfirm", "choose")}  ${keyHint("selectCancel", "cancel")}  Type to search`,
				),
				1,
				0,
			),
		);
		this.addChild(new Spacer(1));
		this.addChild(new DynamicBorder());
		this.addChild(new Spacer(1));

		this.searchInput = new Input();
		this.searchInput.onSubmit = () => {
			this.confirmSelection();
		};
		this.addChild(this.searchInput);

		this.addChild(new Spacer(1));

		this.subagentList = new SubagentSessionList(
			() => this.filteredRows,
			() => this.selectedIndex,
			() => this.searchInput.getValue(),
		);
		this.addChild(this.subagentList);

		this.addChild(new Spacer(1));
		this.addChild(new DynamicBorder());

		this.refreshRows();
	}

	get focused(): boolean {
		return this._focused;
	}

	set focused(value: boolean) {
		this._focused = value;
		this.searchInput.focused = value;
	}

	handleInput(keyData: string): void {
		const kb = getEditorKeybindings();
		if (kb.matches(keyData, "selectUp")) {
			if (this.filteredRows.length === 0) return;
			this.selectedIndex = this.selectedIndex === 0 ? this.filteredRows.length - 1 : this.selectedIndex - 1;
			return;
		}
		if (kb.matches(keyData, "selectDown")) {
			if (this.filteredRows.length === 0) return;
			this.selectedIndex = this.selectedIndex === this.filteredRows.length - 1 ? 0 : this.selectedIndex + 1;
			return;
		}
		if (kb.matches(keyData, "selectConfirm") || keyData === "\n") {
			this.confirmSelection();
			return;
		}
		if (kb.matches(keyData, "selectCancel")) {
			this.onCancel();
			return;
		}
		this.searchInput.handleInput(keyData);
		this.refreshRows();
	}

	getSearchInput(): Input {
		return this.searchInput;
	}

	render(width: number): string[] {
		this.refreshRows();
		return super.render(width);
	}

	private confirmSelection(): void {
		const selected = this.filteredRows[this.selectedIndex];
		if (selected) {
			this.onSelect(selected.snapshot);
		}
	}

	private refreshRows(): void {
		const selectedId = this.filteredRows[this.selectedIndex]?.snapshot.id;
		const rows = this.getSubagents().map(buildSubagentPickerRow);
		const query = this.searchInput.getValue();
		this.filteredRows = query ? fuzzyFilter(rows, query, (row) => row.searchText) : rows;
		const nextSelectedIndex =
			selectedId === undefined ? -1 : this.filteredRows.findIndex((row) => row.snapshot.id === selectedId);
		if (nextSelectedIndex >= 0) {
			this.selectedIndex = nextSelectedIndex;
			return;
		}
		this.selectedIndex = Math.min(this.selectedIndex, Math.max(0, this.filteredRows.length - 1));
	}
}
