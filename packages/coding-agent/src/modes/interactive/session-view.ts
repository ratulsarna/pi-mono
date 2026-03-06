import type { AssistantMessage } from "@mariozechner/pi-ai";
import type {
	CombinedAutocompleteProvider,
	Component,
	EditorComponent,
	Loader,
	Spacer,
	Text,
	TUI,
} from "@mariozechner/pi-tui";
import { Container } from "@mariozechner/pi-tui";
import type { AgentSession } from "../../core/agent-session.js";
import type { KeybindingsManager } from "../../core/keybindings.js";
import type { AssistantMessageComponent } from "./components/assistant-message.js";
import type { BashExecutionComponent } from "./components/bash-execution.js";
import { CustomEditor } from "./components/custom-editor.js";
import type { ExtensionEditorComponent } from "./components/extension-editor.js";
import type { ExtensionInputComponent } from "./components/extension-input.js";
import type { ExtensionSelectorComponent } from "./components/extension-selector.js";
import type { ToolExecutionComponent } from "./components/tool-execution.js";
import { getEditorTheme } from "./theme/theme.js";

export type CompactionQueuedMessage = {
	text: string;
	mode: "steer" | "followUp";
};

export interface InteractiveSessionViewOptions {
	session: AgentSession;
	ui: TUI;
	keybindings: KeybindingsManager;
	editorPaddingX: number;
	autocompleteMaxVisible: number;
	hideThinkingBlock: boolean;
	draftStore: Map<string, string>;
}

export class InteractiveSessionView {
	session: AgentSession;
	readonly chatContainer = new Container();
	readonly pendingMessagesContainer = new Container();
	readonly statusContainer = new Container();
	readonly editorContainer = new Container();
	readonly defaultEditor: CustomEditor;
	editor: EditorComponent;
	loadingAnimation: Loader | undefined = undefined;
	pendingWorkingMessage: string | undefined = undefined;
	readonly defaultWorkingMessage = "Working...";
	lastStatusSpacer: Spacer | undefined = undefined;
	lastStatusText: Text | undefined = undefined;
	streamingComponent: AssistantMessageComponent | undefined = undefined;
	streamingMessage: AssistantMessage | undefined = undefined;
	pendingTools = new Map<string, ToolExecutionComponent>();
	toolOutputExpanded = false;
	hideThinkingBlock: boolean;
	isBashMode = false;
	bashComponent: BashExecutionComponent | undefined = undefined;
	pendingBashComponents: BashExecutionComponent[] = [];
	autoCompactionLoader: Loader | undefined = undefined;
	autoCompactionEscapeHandler: (() => void) | undefined = undefined;
	retryLoader: Loader | undefined = undefined;
	retryEscapeHandler: (() => void) | undefined = undefined;
	compactionQueuedMessages: CompactionQueuedMessage[] = [];
	extensionSelector: ExtensionSelectorComponent | undefined = undefined;
	extensionInput: ExtensionInputComponent | undefined = undefined;
	extensionEditor: ExtensionEditorComponent | undefined = undefined;

	private autocompleteProvider: CombinedAutocompleteProvider | undefined = undefined;
	private readonly draftStore: Map<string, string>;
	private readonly ui: TUI;
	private pendingDialogTeardowns = new Set<() => void>();

	constructor(options: InteractiveSessionViewOptions) {
		this.session = options.session;
		this.ui = options.ui;
		this.hideThinkingBlock = options.hideThinkingBlock;
		this.draftStore = options.draftStore;
		this.defaultEditor = new CustomEditor(options.ui, getEditorTheme(), options.keybindings, {
			paddingX: options.editorPaddingX,
			autocompleteMaxVisible: options.autocompleteMaxVisible,
		});
		this.editor = this.defaultEditor;
		this.editorContainer.addChild(this.editor as Component);
	}

	setAutocompleteProvider(provider: CombinedAutocompleteProvider | undefined): void {
		this.autocompleteProvider = provider;
		if (provider) {
			this.defaultEditor.setAutocompleteProvider(provider);
		}
		if (provider && this.editor !== this.defaultEditor) {
			this.editor.setAutocompleteProvider?.(provider);
		}
	}

	getAutocompleteProvider(): CombinedAutocompleteProvider | undefined {
		return this.autocompleteProvider;
	}

	getSessionIdentity(): string {
		return this.session.sessionFile ?? this.session.sessionId;
	}

	saveDraft(): void {
		const key = this.getSessionIdentity();
		const draft = this.editor.getText();
		if (!draft.trim()) {
			this.draftStore.delete(key);
			return;
		}
		this.draftStore.set(key, draft);
	}

	restoreDraft(): boolean {
		const draft = this.draftStore.get(this.getSessionIdentity());
		this.editor.setText(draft ?? "");
		return typeof draft === "string";
	}

	registerDialogTeardown(teardown: () => void): () => void {
		this.pendingDialogTeardowns.add(teardown);
		return () => {
			this.pendingDialogTeardowns.delete(teardown);
		};
	}

	resetTransientState(): void {
		this.loadingAnimation?.stop();
		this.loadingAnimation = undefined;
		this.pendingWorkingMessage = undefined;
		this.statusContainer.clear();
		this.pendingMessagesContainer.clear();
		this.chatContainer.clear();
		this.lastStatusSpacer = undefined;
		this.lastStatusText = undefined;
		this.streamingComponent = undefined;
		this.streamingMessage = undefined;
		this.pendingTools.clear();
		this.bashComponent = undefined;
		this.pendingBashComponents = [];
		this.autoCompactionLoader?.stop();
		this.autoCompactionLoader = undefined;
		this.autoCompactionEscapeHandler = undefined;
		this.retryLoader?.stop();
		this.retryLoader = undefined;
		this.retryEscapeHandler = undefined;
		this.compactionQueuedMessages = [];
		const teardowns = Array.from(this.pendingDialogTeardowns);
		this.pendingDialogTeardowns.clear();
		for (const teardown of teardowns) {
			teardown();
		}
		this.editorContainer.clear();
		this.editorContainer.addChild(this.editor as Component);
		this.ui.setFocus(this.editor as Component);
		this.ui.requestRender();
	}
}
