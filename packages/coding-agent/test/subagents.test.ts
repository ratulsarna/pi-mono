import { describe, expect, test, vi } from "vitest";
import type { AgentSession } from "../src/core/agent-session.js";
import { SubagentManager } from "../src/core/subagents.js";

function createManager() {
	return new SubagentManager({
		parentSession: {} as AgentSession,
		createSession: vi.fn(),
	});
}

function setRecord(
	manager: SubagentManager,
	record: {
		id: string;
		status: "starting" | "running" | "completed" | "failed" | "cancelled";
		session?: AgentSession;
	},
): void {
	(manager as any).records.set(record.id, {
		id: record.id,
		name: `subagent-${record.id}`,
		prompt: "prompt",
		status: record.status,
		toolNames: [],
		createdAt: 0,
		updatedAt: 0,
		activity: [],
		autoRelay: true,
		shouldRelayOnNextIdle: false,
		session: record.session,
	});
}

describe("SubagentManager.getSession", () => {
	test("returns exact-match sessions, including completed and cancelled live sessions", () => {
		const manager = createManager();
		const completedSession = { sessionId: "completed" } as AgentSession;
		const cancelledSession = { sessionId: "cancelled" } as AgentSession;

		setRecord(manager, { id: "abc12345", status: "completed", session: completedSession });
		setRecord(manager, { id: "def67890", status: "cancelled", session: cancelledSession });

		expect(manager.getSession("abc12345")).toBe(completedSession);
		expect(manager.getSession("def67890")).toBe(cancelledSession);
	});

	test("allows unique prefix matches and returns undefined for ambiguous or unknown prefixes", () => {
		const manager = createManager();
		const firstSession = { sessionId: "first" } as AgentSession;
		const secondSession = { sessionId: "second" } as AgentSession;

		setRecord(manager, { id: "abc12345", status: "running", session: firstSession });
		setRecord(manager, { id: "abd67890", status: "running", session: secondSession });

		expect(manager.getSession("abc")).toBe(firstSession);
		expect(manager.getSession("ab")).toBeUndefined();
		expect(manager.getSession("missing")).toBeUndefined();
	});
});
