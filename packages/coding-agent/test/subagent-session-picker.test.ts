import { beforeAll, describe, expect, test, vi } from "vitest";
import type { SubagentSnapshot } from "../src/core/subagents.js";
import {
	buildSubagentPickerRow,
	formatSubagentSelectionAcknowledgement,
	formatSubagentSessionName,
	SubagentSessionPickerComponent,
} from "../src/modes/interactive/components/subagent-session-picker.js";
import { initTheme } from "../src/modes/interactive/theme/theme.js";

function makeSubagent(overrides: Partial<SubagentSnapshot> = {}): SubagentSnapshot {
	return {
		id: "abc12345",
		name: "Research notes",
		prompt: "Inspect the runtime wiring for the picker",
		status: "running",
		model: "openai/gpt-5.4",
		thinkingLevel: "medium",
		toolNames: [],
		createdAt: 0,
		updatedAt: 0,
		latestAssistantText: "Working through the selector implementation details",
		latestAssistantStopReason: undefined,
		lastError: undefined,
		currentTool: undefined,
		activity: [],
		...overrides,
	};
}

describe("subagent session picker helpers", () => {
	beforeAll(() => {
		initTheme("dark");
	});

	test("formats generated names as sibling sessions", () => {
		const subagent = makeSubagent({ id: "def67890", name: "subagent-def67890" });
		expect(formatSubagentSessionName(subagent)).toBe("Sibling session def67890");
		expect(formatSubagentSelectionAcknowledgement(subagent)).toContain("Sibling session def67890");
	});

	test("builds compact row metadata with tool activity precedence", () => {
		const subagent = makeSubagent({
			currentTool: 'read {"path":"src/modes/interactive/interactive-mode.ts"}',
			model: undefined,
			latestAssistantText: "This text should not win over the active tool",
			activity: [{ timestamp: 1, kind: "assistant", text: "Older activity" }],
		});
		const row = buildSubagentPickerRow(subagent);

		expect(row.title).toBe("Research notes (abc12345)");
		expect(row.meta).toContain("running");
		expect(row.meta).toContain("current model");
		expect(row.meta).toContain("Using read");
	});

	test("prefers newer reply context over historical errors", () => {
		const subagent = makeSubagent({
			status: "completed",
			lastError: "old failure",
			latestAssistantText: "Retry completed successfully",
			activity: [
				{ timestamp: 1, kind: "error", text: "old failure" },
				{ timestamp: 2, kind: "user", text: "Please retry" },
				{ timestamp: 3, kind: "assistant", text: "Retry completed successfully" },
				{ timestamp: 4, kind: "status", text: "Completed" },
			],
		});

		const row = buildSubagentPickerRow(subagent);
		expect(row.meta).toContain("Reply: Retry completed successfully");
		expect(row.meta).not.toContain("Error: old failure");
	});
});

describe("SubagentSessionPickerComponent", () => {
	beforeAll(() => {
		initTheme("dark");
	});

	test("renders an empty picker state", () => {
		const picker = new SubagentSessionPickerComponent(() => [], vi.fn(), vi.fn());
		const output = picker.render(120).join("\n");
		expect(output).toContain("No sibling sessions yet");
	});

	test("refreshes rows when sibling session data changes while open", () => {
		let subagents: SubagentSnapshot[] = [];
		const picker = new SubagentSessionPickerComponent(() => subagents, vi.fn(), vi.fn());

		expect(picker.render(120).join("\n")).toContain("No sibling sessions yet");

		subagents = [
			makeSubagent({
				id: "live1234",
				name: "Live sibling",
				status: "completed",
				latestAssistantText: "Finished the requested check",
				activity: [
					{ timestamp: 1, kind: "assistant", text: "Finished the requested check" },
					{ timestamp: 2, kind: "status", text: "Completed" },
				],
			}),
		];

		const output = picker.render(120).join("\n");
		expect(output).toContain("Live sibling");
		expect(output).toContain("completed");
		expect(output).toContain("Reply: Finished the requested check");
	});

	test("filters sibling sessions by typed search and confirms selection", () => {
		const buildDocs = makeSubagent({
			id: "abc12345",
			name: "Build docs",
			latestAssistantText: "Summarized the README updates",
		});
		const writeTests = makeSubagent({
			id: "def67890",
			name: "Write tests",
			latestAssistantText: "Added focused picker coverage",
		});
		const onSelect = vi.fn<(subagent: SubagentSnapshot) => void>();
		const picker = new SubagentSessionPickerComponent(() => [buildDocs, writeTests], onSelect, vi.fn());

		for (const key of "focused") {
			picker.handleInput(key);
		}

		const filtered = picker.render(120).join("\n");
		expect(filtered).toContain("Write tests");
		expect(filtered).not.toContain("Build docs");

		picker.handleInput("\n");
		expect(onSelect).toHaveBeenCalledTimes(1);
		expect(onSelect).toHaveBeenCalledWith(writeTests);
	});
});
