import { Container } from "@mariozechner/pi-tui";
import { beforeAll, describe, expect, test, vi } from "vitest";
import type { AgentSession } from "../src/core/agent-session.js";
import { InteractiveMode } from "../src/modes/interactive/interactive-mode.js";
import { initTheme } from "../src/modes/interactive/theme/theme.js";

beforeAll(() => {
	initTheme("dark", true);
});

function createSession(id: string, name?: string): AgentSession {
	return {
		sessionId: id,
		sessionFile: undefined,
		sessionName: name,
		autoCompactionEnabled: true,
		sessionManager: {
			getSessionName: vi.fn(() => name),
		},
		navigateTree: vi.fn(),
		subscribe: vi.fn(() => vi.fn()),
	} as unknown as AgentSession;
}

function createView() {
	return {
		chatContainer: new Container(),
		pendingMessagesContainer: new Container(),
		statusContainer: new Container(),
		editorContainer: new Container(),
		saveDraft: vi.fn(),
		resetTransientState: vi.fn(),
		restoreDraft: vi.fn(() => false),
	};
}

describe("InteractiveMode active session routing", () => {
	test("getTreeNavigationSessionManager uses the active session manager while attached", () => {
		const activeSessionManager = {
			getTree: vi.fn(() => []),
			getLeafId: vi.fn(() => null),
			appendLabelChange: vi.fn(),
		};
		const fakeThis = {
			attachedSession: createSession("child", "Child"),
			activeSession: createSession("child", "Child"),
			activeSessionManager,
		};

		const result = (
			InteractiveMode as unknown as { prototype: Record<string, (...args: unknown[]) => unknown> }
		).prototype.getTreeNavigationSessionManager.call(fakeThis);

		expect(result).toBe(activeSessionManager);
	});

	test("syncActiveViewHosts rebinds containers and footer to the active session", () => {
		const session = createSession("main", "Main");
		const activeView = createView();
		const footer = {
			setSession: vi.fn(),
			setAutoCompactEnabled: vi.fn(),
		};
		const fakeThis = {
			activeView,
			activeSession: session,
			chatHost: new Container(),
			pendingMessagesHost: new Container(),
			statusHost: new Container(),
			editorHost: new Container(),
			footer,
		};

		(
			InteractiveMode as unknown as { prototype: Record<string, (...args: unknown[]) => unknown> }
		).prototype.syncActiveViewHosts.call(fakeThis);

		expect(fakeThis.chatHost.children).toEqual([activeView.chatContainer]);
		expect(fakeThis.pendingMessagesHost.children).toEqual([activeView.pendingMessagesContainer]);
		expect(fakeThis.statusHost.children).toEqual([activeView.statusContainer]);
		expect(fakeThis.editorHost.children).toEqual([activeView.editorContainer]);
		expect(footer.setSession).toHaveBeenCalledWith(session);
		expect(footer.setAutoCompactEnabled).toHaveBeenCalledWith(true);
	});

	test("switchActiveSession updates attached session state", () => {
		const mainSession = createSession("main", "Main");
		const childSession = createSession("child", "Child");
		const mainView = createView();
		const childView = createView();
		const ui = { setFocus: vi.fn() };
		const editor = { id: "attached-editor" };
		const fakeThis = {
			session: mainSession,
			mainView,
			activeView: mainView,
			attachedSession: undefined,
			ui,
			editor,
			syncActiveViewHosts: vi.fn(),
			bindActiveSessionSubscription: vi.fn(),
			updateTerminalTitle: vi.fn(),
		};

		(
			InteractiveMode as unknown as { prototype: Record<string, (...args: unknown[]) => unknown> }
		).prototype.switchActiveSession.call(fakeThis, childSession, childView);

		expect(fakeThis.activeView).toBe(childView);
		expect(fakeThis.attachedSession).toBe(childSession);
		expect(fakeThis.syncActiveViewHosts).toHaveBeenCalledTimes(1);
		expect(ui.setFocus).toHaveBeenCalledWith(editor);
		expect(fakeThis.bindActiveSessionSubscription).toHaveBeenCalledTimes(1);
		expect(fakeThis.updateTerminalTitle).toHaveBeenCalledTimes(1);

		(
			InteractiveMode as unknown as { prototype: Record<string, (...args: unknown[]) => unknown> }
		).prototype.switchActiveSession.call(fakeThis, mainSession, mainView);

		expect(fakeThis.activeView).toBe(mainView);
		expect(fakeThis.attachedSession).toBeUndefined();
	});

	test("subscribeToAgent forces detach when the attached sibling disappears", () => {
		let callback:
			| ((event: { type: string; subagent: { id: string; status: string; name: string } }) => void)
			| undefined;
		const subagentManager = {
			subscribe: vi.fn((fn) => {
				callback = fn;
				return vi.fn();
			}),
			getSession: vi.fn(() => undefined),
		};
		const fakeThis = {
			bindActiveSessionSubscription: vi.fn(),
			session: { subagentManager },
			attachedSubagentId: "child-1",
			forceDetachUnavailableSubagent: vi.fn(),
			subagentNoticeStatus: new Map<string, string>(),
			showStatus: vi.fn(),
			showWarning: vi.fn(),
			ui: { requestRender: vi.fn() },
		};

		(
			InteractiveMode as unknown as { prototype: Record<string, (...args: unknown[]) => unknown> }
		).prototype.subscribeToAgent.call(fakeThis);

		callback?.({ type: "updated", subagent: { id: "child-1", status: "running", name: "Child" } });

		expect(fakeThis.bindActiveSessionSubscription).toHaveBeenCalledTimes(1);
		expect(subagentManager.subscribe).toHaveBeenCalledTimes(1);
		expect(fakeThis.forceDetachUnavailableSubagent).toHaveBeenCalledWith("child-1");
	});

	test("forceDetachUnavailableSubagent detaches only the active matching sibling", () => {
		const attachedSession = createSession("child", "Child");
		const detachToMainSession = vi.fn();
		const fakeThis = {
			attachedSession,
			attachedSubagentId: "child-1",
			detachToMainSession,
		};

		(
			InteractiveMode as unknown as { prototype: Record<string, (...args: unknown[]) => unknown> }
		).prototype.forceDetachUnavailableSubagent.call(fakeThis, "other");
		expect(detachToMainSession).not.toHaveBeenCalled();

		(
			InteractiveMode as unknown as { prototype: Record<string, (...args: unknown[]) => unknown> }
		).prototype.forceDetachUnavailableSubagent.call(fakeThis, "child-1");
		expect(detachToMainSession).toHaveBeenCalledWith("Attached sibling session child-1 is no longer available");
	});

	test("attachToSubagentSession saves the current draft and rerenders the attached view", () => {
		const childSession = createSession("child", "Child");
		const childView = createView();
		const fakeThis = {
			saveActiveViewDraft: vi.fn(),
			getOrCreateAttachedView: vi.fn(() => childView),
			switchActiveSession: vi.fn(),
			rerenderActiveViewForSessionChange: vi.fn(),
			showStatus: vi.fn(),
			attachedSubagentId: undefined,
		};

		(
			InteractiveMode as unknown as { prototype: Record<string, (...args: unknown[]) => unknown> }
		).prototype.attachToSubagentSession.call(fakeThis, "child-1", childSession);

		expect(fakeThis.saveActiveViewDraft).toHaveBeenCalledTimes(1);
		expect(fakeThis.getOrCreateAttachedView).toHaveBeenCalledWith(childSession);
		expect(fakeThis.switchActiveSession).toHaveBeenCalledWith(childSession, childView);
		expect(fakeThis.rerenderActiveViewForSessionChange).toHaveBeenCalledTimes(1);
		expect(fakeThis.attachedSubagentId).toBe("child-1");
	});

	test("bindActiveSessionSubscription ignores stale callbacks after switching sessions", async () => {
		let staleCallback: ((event: { type: string }) => Promise<void>) | undefined;
		let activeCallback: ((event: { type: string }) => Promise<void>) | undefined;
		const unsubscribeStale = vi.fn();
		const staleSession = {
			subscribe: vi.fn((callback: (event: { type: string }) => Promise<void>) => {
				staleCallback = callback;
				return unsubscribeStale;
			}),
		};
		const activeSession = {
			subscribe: vi.fn((callback: (event: { type: string }) => Promise<void>) => {
				activeCallback = callback;
				return vi.fn();
			}),
		};
		const prototype = InteractiveMode as unknown as {
			prototype: Record<string, (...args: unknown[]) => unknown>;
		};
		const fakeThis = {
			activeSession: staleSession,
			activeSessionUnsubscribe: undefined as (() => void) | undefined,
			activeSessionSubscriptionEpoch: 0,
			handleEvent: vi.fn(),
			isActiveSessionEvent: prototype.prototype.isActiveSessionEvent,
		};

		prototype.prototype.bindActiveSessionSubscription.call(fakeThis);
		fakeThis.activeSession = activeSession;
		prototype.prototype.bindActiveSessionSubscription.call(fakeThis);

		await staleCallback?.({ type: "agent_start" });
		await activeCallback?.({ type: "agent_start" });

		expect(unsubscribeStale).toHaveBeenCalledTimes(1);
		expect(fakeThis.handleEvent).toHaveBeenCalledTimes(1);
	});

	test("handleNameCommand updates the active session manager while attached", () => {
		const activeSessionManager = {
			getSessionName: vi.fn(() => "Child"),
			appendSessionInfo: vi.fn(),
		};
		const fakeThis = {
			activeSessionManager,
			updateTerminalTitle: vi.fn(),
			chatContainer: new Container(),
			ui: { requestRender: vi.fn() },
		};

		(
			InteractiveMode as unknown as { prototype: Record<string, (...args: unknown[]) => unknown> }
		).prototype.handleNameCommand.call(fakeThis, "/name Renamed child");

		expect(activeSessionManager.appendSessionInfo).toHaveBeenCalledWith("Renamed child");
		expect(fakeThis.updateTerminalTitle).toHaveBeenCalledTimes(1);
	});

	test("handleCompactCommand checks entry count from the active session manager", async () => {
		const activeSessionManager = {
			getEntries: vi.fn(() => [{ type: "message" }, { type: "message" }]),
		};
		const fakeThis = {
			activeSessionManager,
			executeCompaction: vi.fn(),
			showWarning: vi.fn(),
		};
		const prototype = InteractiveMode as unknown as {
			prototype: Record<string, (...args: unknown[]) => Promise<void>>;
		};

		await prototype.prototype.handleCompactCommand.call(fakeThis, "custom");

		expect(activeSessionManager.getEntries).toHaveBeenCalledTimes(1);
		expect(fakeThis.executeCompaction).toHaveBeenCalledWith("custom", false);
		expect(fakeThis.showWarning).not.toHaveBeenCalled();
	});

	test("handleResumeSession switches the active session while attached", async () => {
		const mainSession = {
			switchSession: vi.fn(),
		};
		const activeSession = {
			switchSession: vi.fn(async () => true),
		};
		const fakeThis = {
			session: mainSession,
			activeSession,
			saveActiveViewDraft: vi.fn(),
			rerenderActiveViewForSessionChange: vi.fn(),
			showStatus: vi.fn(),
		};
		const prototype = InteractiveMode as unknown as {
			prototype: Record<string, (...args: unknown[]) => Promise<void>>;
		};

		await prototype.prototype.handleResumeSession.call(fakeThis, "/tmp/attached-session.json");

		expect(activeSession.switchSession).toHaveBeenCalledWith("/tmp/attached-session.json");
		expect(mainSession.switchSession).not.toHaveBeenCalled();
		expect(fakeThis.rerenderActiveViewForSessionChange).toHaveBeenCalledTimes(1);
		expect(fakeThis.showStatus).toHaveBeenCalledWith("Resumed session");
	});
});

describe("InteractiveMode /back command", () => {
	test("shows a no-op status from the main session", async () => {
		const editor = {
			setText: vi.fn(),
			addToHistory: vi.fn(),
		};
		const defaultEditor = editor as { onSubmit?: (text: string) => Promise<void> } & typeof editor;
		const fakeThis = {
			mainView: { defaultEditor },
			bindSubmitHandler: (
				InteractiveMode as unknown as { prototype: Record<string, (...args: unknown[]) => unknown> }
			).prototype.bindSubmitHandler,
			defaultEditor,
			editor,
			attachedSession: undefined,
			showStatus: vi.fn(),
		};

		(
			InteractiveMode as unknown as { prototype: Record<string, (...args: unknown[]) => unknown> }
		).prototype.setupEditorSubmitHandler.call(fakeThis);

		await defaultEditor.onSubmit?.("/back");

		expect(editor.setText).toHaveBeenCalledWith("");
		expect(fakeThis.showStatus).toHaveBeenCalledWith("Already in the main session");
	});

	test("detaches to the main session when attached", async () => {
		const editor = {
			setText: vi.fn(),
			addToHistory: vi.fn(),
		};
		const defaultEditor = editor as { onSubmit?: (text: string) => Promise<void> } & typeof editor;
		const fakeThis = {
			mainView: { defaultEditor },
			bindSubmitHandler: (
				InteractiveMode as unknown as { prototype: Record<string, (...args: unknown[]) => unknown> }
			).prototype.bindSubmitHandler,
			defaultEditor,
			editor,
			attachedSession: createSession("child", "Child"),
			detachToMainSession: vi.fn(),
			showStatus: vi.fn(),
		};

		(
			InteractiveMode as unknown as { prototype: Record<string, (...args: unknown[]) => unknown> }
		).prototype.setupEditorSubmitHandler.call(fakeThis);

		await defaultEditor.onSubmit?.("/back");

		expect(fakeThis.detachToMainSession).toHaveBeenCalledWith("Returned to main session");
		expect(fakeThis.showStatus).not.toHaveBeenCalled();
	});
});
