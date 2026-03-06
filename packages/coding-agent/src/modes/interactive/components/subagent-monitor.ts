import { type Focusable, matchesKey, visibleWidth } from "@mariozechner/pi-tui";
import type { SubagentSnapshot } from "../../../core/subagents.js";
import type { Theme } from "../theme/theme.js";

interface SubagentMonitorCallbacks {
	onCancel: (id: string) => void;
	onClose: () => void;
}

function pad(text: string, width: number): string {
	return text + " ".repeat(Math.max(0, width - visibleWidth(text)));
}

function statusText(theme: Theme, status: SubagentSnapshot["status"]): string {
	switch (status) {
		case "running":
			return theme.fg("warning", "running");
		case "completed":
			return theme.fg("success", "completed");
		case "failed":
			return theme.fg("error", "failed");
		case "cancelled":
			return theme.fg("muted", "cancelled");
		default:
			return theme.fg("dim", status);
	}
}

function kindPrefix(kind: string): string {
	switch (kind) {
		case "tool":
			return "→";
		case "assistant":
			return "A";
		case "user":
			return "U";
		case "error":
			return "!";
		default:
			return "•";
	}
}

export class SubagentMonitorComponent implements Focusable {
	readonly width = 100;
	focused = false;
	private selected = 0;

	constructor(
		private theme: Theme,
		private getSubagents: () => SubagentSnapshot[],
		private callbacks: SubagentMonitorCallbacks,
	) {}

	handleInput(data: string): void {
		const subagents = this.getSubagents();
		if (matchesKey(data, "escape") || matchesKey(data, "return")) {
			this.callbacks.onClose();
			return;
		}
		if (matchesKey(data, "up")) {
			this.selected = Math.max(0, this.selected - 1);
			return;
		}
		if (matchesKey(data, "down")) {
			this.selected = Math.min(Math.max(0, subagents.length - 1), this.selected + 1);
			return;
		}
		if ((data === "c" || data === "C") && subagents[this.selected]) {
			this.callbacks.onCancel(subagents[this.selected].id);
		}
	}

	render(_width: number): string[] {
		const theme = this.theme;
		const subagents = this.getSubagents();
		const width = this.width;
		const innerWidth = width - 2;
		const row = (content: string) => theme.fg("border", "│") + pad(content, innerWidth) + theme.fg("border", "│");
		const lines: string[] = [];

		if (this.selected >= subagents.length) {
			this.selected = Math.max(0, subagents.length - 1);
		}

		lines.push(theme.fg("border", `╭${"─".repeat(innerWidth)}╮`));
		lines.push(row(` ${theme.fg("accent", theme.bold("Subagents"))}`));
		lines.push(row(""));

		if (subagents.length === 0) {
			lines.push(row(` ${theme.fg("muted", "No subagents yet.")}`));
			lines.push(row(""));
			lines.push(row(` ${theme.fg("dim", "Esc closes")}`));
			lines.push(theme.fg("border", `╰${"─".repeat(innerWidth)}╯`));
			return lines;
		}

		lines.push(row(` ${theme.fg("dim", "Use ↑↓ to inspect • c to cancel selected • Esc to close")}`));
		lines.push(row(""));
		lines.push(row(` ${theme.fg("muted", "─── List ───")}`));

		for (let i = 0; i < Math.min(subagents.length, 8); i++) {
			const subagent = subagents[i];
			const isSelected = i === this.selected;
			const prefix = isSelected ? theme.fg("accent", "▶") : " ";
			const summary = `${subagent.name} (${subagent.id})`;
			const meta = [statusText(theme, subagent.status), subagent.model, subagent.thinkingLevel]
				.filter(Boolean)
				.join(theme.fg("dim", " • "));
			lines.push(row(` ${prefix} ${theme.fg(isSelected ? "accent" : "text", summary)}`));
			lines.push(row(`   ${theme.fg("dim", meta || "—")}`));
			const preview = subagent.currentTool || subagent.latestAssistantText || subagent.lastError || subagent.prompt;
			lines.push(row(`   ${theme.fg("muted", preview.replace(/\s+/g, " ").slice(0, 82))}`));
		}

		const selected = subagents[this.selected];
		if (selected) {
			lines.push(row(""));
			lines.push(row(` ${theme.fg("muted", "─── Details ───")}`));
			lines.push(row(` ${theme.fg("text", selected.prompt.replace(/\s+/g, " ").slice(0, 92))}`));
			if (selected.latestAssistantText) {
				lines.push(row(` ${theme.fg("accent", "Latest reply:")}`));
				for (const line of selected.latestAssistantText.split("\n").slice(0, 4)) {
					lines.push(row(` ${theme.fg("text", line.slice(0, 94))}`));
				}
			}
			if (selected.activity.length > 0) {
				lines.push(row(` ${theme.fg("accent", "Recent activity:")}`));
				for (const item of selected.activity.slice(-6)) {
					lines.push(
						row(` ${theme.fg("dim", kindPrefix(item.kind))} ${theme.fg("muted", item.text.slice(0, 92))}`),
					);
				}
			}
			lines.push(row(""));
			lines.push(row(` ${theme.fg("dim", `Talk to it with /subagent-send ${selected.id} <message>`)}`));
		}

		lines.push(theme.fg("border", `╰${"─".repeat(innerWidth)}╯`));
		return lines;
	}

	invalidate(): void {}
	dispose(): void {}
}
