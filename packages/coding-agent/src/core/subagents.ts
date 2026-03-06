import { randomUUID } from "node:crypto";
import type { AgentMessage, ThinkingLevel } from "@mariozechner/pi-agent-core";
import type { AssistantMessage, ImageContent, Message, TextContent } from "@mariozechner/pi-ai";
import type { AgentSession, AgentSessionEvent } from "./agent-session.js";

export type SubagentStatus = "starting" | "running" | "completed" | "failed" | "cancelled";

export interface SpawnSubagentOptions {
	prompt: string;
	name?: string;
	model?: string;
	thinkingLevel?: ThinkingLevel;
	toolNames?: string[];
	autoRelay?: boolean;
}

export interface CreateSubagentSessionOptions {
	model?: string;
	thinkingLevel?: ThinkingLevel;
	toolNames?: string[];
	name?: string;
}

export interface SubagentActivity {
	timestamp: number;
	kind: "status" | "user" | "assistant" | "tool" | "error";
	text: string;
}

interface SubagentRecord {
	id: string;
	name: string;
	prompt: string;
	status: SubagentStatus;
	model?: string;
	thinkingLevel?: ThinkingLevel;
	toolNames: string[];
	createdAt: number;
	updatedAt: number;
	latestAssistantText?: string;
	latestAssistantStopReason?: string;
	lastError?: string;
	currentTool?: string;
	activity: SubagentActivity[];
	autoRelay: boolean;
	shouldRelayOnNextIdle: boolean;
	session?: AgentSession;
	unsubscribe?: () => void;
}

export interface SubagentSnapshot {
	id: string;
	name: string;
	prompt: string;
	status: SubagentStatus;
	model?: string;
	thinkingLevel?: ThinkingLevel;
	toolNames: string[];
	createdAt: number;
	updatedAt: number;
	latestAssistantText?: string;
	latestAssistantStopReason?: string;
	lastError?: string;
	currentTool?: string;
	activity: SubagentActivity[];
}

export type SubagentEvent =
	| { type: "added"; subagent: SubagentSnapshot }
	| { type: "updated"; subagent: SubagentSnapshot }
	| { type: "removed"; subagent: SubagentSnapshot };

export interface SendSubagentMessageOptions {
	deliverAs?: "steer" | "followUp";
	images?: ImageContent[];
}

export interface SubagentManagerOptions {
	parentSession: AgentSession;
	createSession: (options: CreateSubagentSessionOptions) => Promise<AgentSession>;
}

const MAX_ACTIVITY = 40;

function toText(content: string | unknown[] | undefined): string {
	if (!content) return "";
	if (typeof content === "string") return content;
	return content
		.filter(
			(part): part is TextContent =>
				Boolean(part) && typeof part === "object" && (part as { type?: string }).type === "text",
		)
		.map((part) => part.text)
		.join("\n")
		.trim();
}

function getAssistantText(message: AgentMessage | Message | undefined): string {
	if (!message || message.role !== "assistant") return "";
	return toText(message.content);
}

function getLastAssistantMessage(messages: AgentMessage[]): AssistantMessage | undefined {
	for (let i = messages.length - 1; i >= 0; i--) {
		const message = messages[i];
		if (message.role === "assistant") {
			return message as AssistantMessage;
		}
	}
	return undefined;
}

function compactWhitespace(text: string): string {
	return text.replace(/\s+/g, " ").trim();
}

function preview(text: string | undefined, maxLength = 180): string {
	const normalized = compactWhitespace(text ?? "");
	if (!normalized) return "";
	return normalized.length > maxLength ? `${normalized.slice(0, maxLength - 1)}…` : normalized;
}

function formatToolCall(toolName: string, args: unknown): string {
	const serialized = (() => {
		try {
			return JSON.stringify(args);
		} catch {
			return "{}";
		}
	})();
	const normalized = compactWhitespace(serialized);
	return normalized ? `${toolName} ${normalized}` : toolName;
}

function buildVisibleRelayMessage(record: SubagentRecord): string {
	const status = record.status === "completed" ? "completed" : record.status;
	const header = `Subagent "${record.name}" (${record.id}) ${status}.`;
	if (record.status === "failed") {
		return `${header}\n\n${record.lastError || record.latestAssistantText || "No error details."}`;
	}
	if (record.status === "cancelled") {
		return `${header}\n\nCancelled before a final response was produced.`;
	}
	const resultPreview = preview(record.latestAssistantText, 400);
	return resultPreview ? `${header}\n\n${resultPreview}` : header;
}

function buildHiddenRelayMessage(record: SubagentRecord): string {
	const lines = [
		`Subagent result received from "${record.name}" (${record.id}).`,
		"Use this as delegated work product for the parent task.",
		"",
		`Status: ${record.status}`,
	];
	if (record.model) lines.push(`Model: ${record.model}`);
	if (record.thinkingLevel) lines.push(`Thinking level: ${record.thinkingLevel}`);
	if (record.toolNames.length > 0) lines.push(`Tools: ${record.toolNames.join(", ")}`);
	lines.push("", "Original subagent prompt:", record.prompt, "");

	if (record.status === "failed") {
		lines.push("Failure details:", record.lastError || record.latestAssistantText || "No failure details.");
	} else if (record.status === "cancelled") {
		lines.push("The subagent was cancelled before completion.");
	} else {
		lines.push("Final subagent response:", record.latestAssistantText || "(no response text)");
	}

	lines.push("", "Continue the parent task from here.");
	return lines.join("\n");
}

export class SubagentManager {
	private parentSession: AgentSession;
	private createSession: (options: CreateSubagentSessionOptions) => Promise<AgentSession>;
	private records = new Map<string, SubagentRecord>();
	private listeners = new Set<(event: SubagentEvent) => void>();

	constructor(options: SubagentManagerOptions) {
		this.parentSession = options.parentSession;
		this.createSession = options.createSession;
	}

	subscribe(listener: (event: SubagentEvent) => void): () => void {
		this.listeners.add(listener);
		return () => {
			this.listeners.delete(listener);
		};
	}

	list(): SubagentSnapshot[] {
		return Array.from(this.records.values())
			.map((record) => this.snapshot(record))
			.sort((a, b) => b.updatedAt - a.updatedAt);
	}

	get(idOrPrefix: string): SubagentSnapshot | undefined {
		const record = this.resolve(idOrPrefix);
		return record ? this.snapshot(record) : undefined;
	}

	getSession(idOrPrefix: string): AgentSession | undefined {
		return this.resolve(idOrPrefix)?.session;
	}

	resolve(idOrPrefix: string): SubagentRecord | undefined {
		const input = idOrPrefix.trim();
		if (!input) return undefined;
		if (this.records.has(input)) return this.records.get(input);
		const matches = Array.from(this.records.values()).filter((record) => record.id.startsWith(input));
		if (matches.length !== 1) return undefined;
		return matches[0];
	}

	async spawn(options: SpawnSubagentOptions): Promise<SubagentSnapshot> {
		const id = randomUUID().slice(0, 8);
		const record: SubagentRecord = {
			id,
			name: options.name?.trim() || `subagent-${id}`,
			prompt: options.prompt,
			status: "starting",
			model: options.model,
			thinkingLevel: options.thinkingLevel,
			toolNames: [...(options.toolNames ?? [])],
			createdAt: Date.now(),
			updatedAt: Date.now(),
			activity: [],
			autoRelay: options.autoRelay ?? true,
			shouldRelayOnNextIdle: options.autoRelay ?? true,
		};

		this.records.set(id, record);
		this.pushActivity(record, "status", `Started with ${record.model ?? "inherited model"}`);
		this.emit({ type: "added", subagent: this.snapshot(record) });

		try {
			const session = await this.createSession({
				model: options.model,
				thinkingLevel: options.thinkingLevel,
				toolNames: options.toolNames,
				name: record.name,
			});
			record.session = session;
			record.unsubscribe = session.subscribe((event) => this.handleSessionEvent(record, event));
			record.status = "running";
			record.updatedAt = Date.now();
			this.emit({ type: "updated", subagent: this.snapshot(record) });

			void session.prompt(options.prompt).catch((error) => {
				this.fail(record, error instanceof Error ? error.message : String(error));
			});
		} catch (error) {
			this.fail(record, error instanceof Error ? error.message : String(error));
		}

		return this.snapshot(record);
	}

	async sendMessage(idOrPrefix: string, text: string, options?: SendSubagentMessageOptions): Promise<void> {
		const record = this.resolve(idOrPrefix);
		if (!record || !record.session) {
			throw new Error(`Unknown subagent: ${idOrPrefix}`);
		}
		const message = text.trim();
		if (!message) {
			throw new Error("Message cannot be empty");
		}

		record.status = "running";
		record.shouldRelayOnNextIdle = true;
		record.updatedAt = Date.now();
		this.pushActivity(record, "user", preview(message, 240) || "(message sent)");
		this.emit({ type: "updated", subagent: this.snapshot(record) });

		await record.session.prompt(message, {
			images: options?.images,
			streamingBehavior: options?.deliverAs,
			source: "extension",
		});
	}

	async cancel(idOrPrefix: string): Promise<void> {
		const record = this.resolve(idOrPrefix);
		if (!record || !record.session) {
			throw new Error(`Unknown subagent: ${idOrPrefix}`);
		}
		record.status = "cancelled";
		record.shouldRelayOnNextIdle = false;
		record.updatedAt = Date.now();
		this.pushActivity(record, "status", "Cancelled");
		this.emit({ type: "updated", subagent: this.snapshot(record) });
		await record.session.abort();
	}

	dispose(): void {
		for (const record of this.records.values()) {
			record.unsubscribe?.();
		}
		this.records.clear();
	}

	private handleSessionEvent(record: SubagentRecord, event: AgentSessionEvent): void {
		record.updatedAt = Date.now();

		switch (event.type) {
			case "message_start": {
				if (event.message.role === "assistant") {
					record.status = "running";
				}
				break;
			}
			case "message_update": {
				if (event.message.role === "assistant") {
					const text = getAssistantText(event.message);
					if (text) {
						record.latestAssistantText = text;
					}
				}
				break;
			}
			case "message_end": {
				if (event.message.role === "assistant") {
					const text = getAssistantText(event.message);
					if (text) {
						record.latestAssistantText = text;
						this.pushActivity(record, "assistant", preview(text, 240) || "(assistant response)");
					}
					const assistant = event.message as AssistantMessage;
					record.latestAssistantStopReason = assistant.stopReason;
					if (assistant.stopReason === "error") {
						record.lastError = assistant.errorMessage || preview(text, 240) || "Assistant error";
					}
				}
				break;
			}
			case "tool_execution_start": {
				record.currentTool = formatToolCall(event.toolName, event.args);
				this.pushActivity(record, "tool", record.currentTool);
				break;
			}
			case "tool_execution_end": {
				record.currentTool = undefined;
				break;
			}
			case "agent_end": {
				const lastAssistant = getLastAssistantMessage(record.session?.messages ?? []);
				const stopReason = lastAssistant?.stopReason;
				record.latestAssistantStopReason = stopReason;
				if (stopReason === "error") {
					record.status = "failed";
					record.lastError = lastAssistant?.errorMessage || record.lastError || "Assistant error";
					this.pushActivity(record, "error", preview(record.lastError, 240) || "Assistant error");
				} else if (record.status !== "cancelled") {
					record.status = "completed";
					this.pushActivity(record, "status", "Completed");
				}
				void this.maybeRelay(record);
				break;
			}
		}

		this.emit({ type: "updated", subagent: this.snapshot(record) });
	}

	private async maybeRelay(record: SubagentRecord): Promise<void> {
		if (!record.autoRelay || !record.shouldRelayOnNextIdle) {
			return;
		}
		record.shouldRelayOnNextIdle = false;

		const visibleMessage = buildVisibleRelayMessage(record);
		if (this.parentSession.isStreaming) {
			await this.parentSession.sendCustomMessage(
				{
					customType: "subagent-status",
					content: visibleMessage,
					display: true,
					details: {
						id: record.id,
						name: record.name,
						status: record.status,
					},
				},
				{ deliverAs: "followUp" },
			);
		} else {
			await this.parentSession.sendCustomMessage(
				{
					customType: "subagent-status",
					content: visibleMessage,
					display: true,
					details: {
						id: record.id,
						name: record.name,
						status: record.status,
					},
				},
				{ triggerTurn: false },
			);
		}

		const hiddenRelay = buildHiddenRelayMessage(record);
		if (this.parentSession.isStreaming) {
			await this.parentSession.sendCustomMessage(
				{
					customType: "subagent-result",
					content: hiddenRelay,
					display: false,
					details: { id: record.id, name: record.name, status: record.status },
				},
				{ deliverAs: "followUp" },
			);
		} else {
			await this.parentSession.sendCustomMessage(
				{
					customType: "subagent-result",
					content: hiddenRelay,
					display: false,
					details: { id: record.id, name: record.name, status: record.status },
				},
				{ triggerTurn: true },
			);
		}
	}

	private fail(record: SubagentRecord, error: string): void {
		record.status = "failed";
		record.lastError = error;
		record.updatedAt = Date.now();
		this.pushActivity(record, "error", preview(error, 240) || "Failed");
		this.emit({ type: "updated", subagent: this.snapshot(record) });
		void this.maybeRelay(record);
	}

	private pushActivity(record: SubagentRecord, kind: SubagentActivity["kind"], text: string): void {
		if (!text.trim()) return;
		record.activity.push({ timestamp: Date.now(), kind, text });
		if (record.activity.length > MAX_ACTIVITY) {
			record.activity.splice(0, record.activity.length - MAX_ACTIVITY);
		}
	}

	private snapshot(record: SubagentRecord): SubagentSnapshot {
		return {
			id: record.id,
			name: record.name,
			prompt: record.prompt,
			status: record.status,
			model: record.model,
			thinkingLevel: record.thinkingLevel,
			toolNames: [...record.toolNames],
			createdAt: record.createdAt,
			updatedAt: record.updatedAt,
			latestAssistantText: record.latestAssistantText,
			latestAssistantStopReason: record.latestAssistantStopReason,
			lastError: record.lastError,
			currentTool: record.currentTool,
			activity: record.activity.map((entry) => ({ ...entry })),
		};
	}

	private emit(event: SubagentEvent): void {
		for (const listener of this.listeners) {
			listener(event);
		}
	}
}
