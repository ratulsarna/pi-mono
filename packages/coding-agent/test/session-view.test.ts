import { Container } from "@mariozechner/pi-tui";
import { describe, expect, test, vi } from "vitest";
import { InteractiveSessionView } from "../src/modes/interactive/session-view.js";

describe("InteractiveSessionView.resetTransientState", () => {
	test("runs pending dialog teardowns and restores editor focus", () => {
		const loadingAnimation = { stop: vi.fn() };
		const autoCompactionLoader = { stop: vi.fn() };
		const retryLoader = { stop: vi.fn() };
		const teardown = vi.fn();
		const editor = { render: () => [""], invalidate: () => {} };
		const fakeThis: any = {
			loadingAnimation,
			pendingWorkingMessage: "Working...",
			statusContainer: new Container(),
			pendingMessagesContainer: new Container(),
			chatContainer: new Container(),
			lastStatusSpacer: {},
			lastStatusText: {},
			streamingComponent: {},
			streamingMessage: {},
			pendingTools: new Map([["tool", {}]]),
			bashComponent: {},
			pendingBashComponents: [{}],
			autoCompactionLoader,
			autoCompactionEscapeHandler: vi.fn(),
			retryLoader,
			retryEscapeHandler: vi.fn(),
			compactionQueuedMessages: [{ text: "queued", mode: "followUp" }],
			pendingDialogTeardowns: new Set([teardown]),
			editorContainer: new Container(),
			editor,
			ui: { setFocus: vi.fn(), requestRender: vi.fn() },
		};

		(InteractiveSessionView as any).prototype.resetTransientState.call(fakeThis);

		expect(loadingAnimation.stop).toHaveBeenCalledTimes(1);
		expect(autoCompactionLoader.stop).toHaveBeenCalledTimes(1);
		expect(retryLoader.stop).toHaveBeenCalledTimes(1);
		expect(teardown).toHaveBeenCalledTimes(1);
		expect(fakeThis.pendingTools.size).toBe(0);
		expect(fakeThis.pendingDialogTeardowns.size).toBe(0);
		expect(fakeThis.ui.setFocus).toHaveBeenCalledWith(editor);
		expect(fakeThis.ui.requestRender).toHaveBeenCalledTimes(1);
	});
});
