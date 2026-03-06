import { StringEnum } from "@mariozechner/pi-ai";
import { Text } from "@mariozechner/pi-tui";
import { Type } from "@sinclair/typebox";
import type { ToolDefinition } from "./extensions/index.js";
import type { SubagentManager } from "./subagents.js";

const ThinkingLevelSchema = StringEnum(["off", "minimal", "low", "medium", "high", "xhigh"] as const, {
	description: "Reasoning / thinking level for the subagent. Defaults to inheriting the parent session.",
});

const SubagentParams = Type.Object({
	prompt: Type.String({ description: "The task or prompt to send to the subagent." }),
	name: Type.Optional(Type.String({ description: "Optional human-friendly label for the subagent." })),
	model: Type.Optional(
		Type.String({
			description: "Model to use, in provider/modelId format. Defaults to inheriting the parent model.",
		}),
	),
	thinkingLevel: Type.Optional(ThinkingLevelSchema),
	tools: Type.Optional(
		Type.Array(Type.String(), {
			description:
				"Optional list of active tools for the subagent (for example: read, grep, find, ls, bash). Defaults to the standard coding tool set.",
		}),
	),
});

export interface SubagentToolDetails {
	id: string;
	name: string;
	status: string;
	model?: string;
	thinkingLevel?: string;
	tools: string[];
}

export function createSubagentToolDefinition(
	manager: SubagentManager,
): ToolDefinition<typeof SubagentParams, SubagentToolDetails> {
	return {
		name: "subagent",
		label: "Subagent",
		description:
			"Spawn a background subagent with its own model, thinking level, and tool set. Use it for delegated work that should run asynchronously and report back into the main conversation when finished.",
		promptSnippet:
			"subagent: spawn a background helper for delegated work. Supports prompt, optional provider/modelId, thinkingLevel, and tools.",
		promptGuidelines: [
			"Use the subagent tool when a self-contained analysis should run in the background and report back later.",
			"After spawning a subagent, do not assume its result yet. Wait for the subagent result message before continuing dependent work.",
		],
		parameters: SubagentParams,
		async execute(_toolCallId, params) {
			const subagent = await manager.spawn({
				prompt: params.prompt,
				name: params.name,
				model: params.model,
				thinkingLevel: params.thinkingLevel,
				toolNames: params.tools,
			});

			const description = [
				`Started subagent ${subagent.name} (${subagent.id}).`,
				subagent.model ? `Model: ${subagent.model}` : undefined,
				subagent.thinkingLevel ? `Thinking: ${subagent.thinkingLevel}` : undefined,
				subagent.toolNames.length > 0 ? `Tools: ${subagent.toolNames.join(", ")}` : undefined,
				"Its result will be injected back into the main conversation when it finishes.",
			]
				.filter(Boolean)
				.join("\n");

			return {
				content: [{ type: "text", text: description }],
				details: {
					id: subagent.id,
					name: subagent.name,
					status: subagent.status,
					model: subagent.model,
					thinkingLevel: subagent.thinkingLevel,
					tools: subagent.toolNames,
				},
			};
		},
		renderCall(args, theme) {
			const name = args.name || "background worker";
			const prompt = args.prompt.length > 90 ? `${args.prompt.slice(0, 89)}…` : args.prompt;
			const header = theme.fg("toolTitle", theme.bold("subagent ")) + theme.fg("accent", name);
			const meta = [args.model, args.thinkingLevel].filter(Boolean).join(" • ");
			const tools = args.tools?.length ? `tools: ${args.tools.join(", ")}` : "";
			const lines = [
				header,
				meta ? theme.fg("dim", meta) : "",
				theme.fg("muted", prompt),
				tools ? theme.fg("dim", tools) : "",
			]
				.filter(Boolean)
				.join("\n");
			return new Text(lines, 0, 0);
		},
		renderResult(result, _options, theme) {
			const details = result.details;
			const lines = [
				theme.fg("success", `✓ ${details?.name ?? "Subagent"}`),
				theme.fg("dim", `id: ${details?.id ?? "unknown"}`),
			];
			if (details?.model) lines.push(theme.fg("dim", `model: ${details.model}`));
			if (details?.thinkingLevel) lines.push(theme.fg("dim", `thinking: ${details.thinkingLevel}`));
			if (details?.tools?.length) lines.push(theme.fg("dim", `tools: ${details.tools.join(", ")}`));
			return new Text(lines.join("\n"), 0, 0);
		},
	};
}
