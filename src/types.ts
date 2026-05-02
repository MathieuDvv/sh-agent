export type ProviderId = "deepseek" | "openai" | "google" | "anthropic" | "nvidia";

export type Mode = "ask" | "act";

export type AccentColor = "yellow" | "cyan" | "green" | "magenta" | "blue" | "white";

export type PersonalityId = "balanced" | "concise" | "mentor" | "engineer" | "planner" | "custom";

export type UiConfig = {
  accentColor: AccentColor;
  showModelInTitle: boolean;
  dimSelectorItems: boolean;
  compactBoxes: boolean;
  showToolTrace: boolean;
  confirmBeforeModify: boolean;
};

export type ModelRef = {
  id: string;
  provider: ProviderId;
  label: string;
  description: string;
};

export type AppConfig = {
  provider: ProviderId;
  model: string;
  personality: PersonalityId;
  apiKeys?: Partial<Record<ProviderId, string>>;
  ui: UiConfig;
};

export type ChatMessage =
  | {role: "system"; content: string}
  | {role: "user"; content: string}
  | {role: "assistant"; content: string | null; tool_calls?: ToolCall[]; reasoning_content?: string}
  | {role: "tool"; content: string; tool_call_id: string};

export type ToolCall = {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
};

export type ToolDefinition = {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
};

export type ChatResponse = {
  choices: Array<{
    message: {
      content?: string | null;
      tool_calls?: ToolCall[];
      reasoning_content?: string;
    };
    finish_reason?: string;
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
};
