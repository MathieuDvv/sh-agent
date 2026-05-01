import type {ChatMessage, ChatResponse, Mode, ModelRef, ProviderId, ToolDefinition} from "./types.js";

export type Provider = {
  id: ProviderId;
  label: string;
  api: "openai-compatible" | "anthropic";
  baseUrl: string;
  modelListUrl?: string;
  apiKeyEnv: string;
  models: ModelRef[];
  supportsBalance: boolean;
};

export const providers: Record<ProviderId, Provider> = {
  deepseek: {
    id: "deepseek",
    label: "DeepSeek",
    api: "openai-compatible",
    baseUrl: "https://api.deepseek.com",
    apiKeyEnv: "DEEPSEEK_API_KEY",
    supportsBalance: true,
    models: [
      {
        id: "deepseek-v4-flash",
        provider: "deepseek",
        label: "DeepSeek V4 Flash",
        description: "Cheap default for testing and everyday agent work"
      },
      {
        id: "deepseek-v4-pro",
        provider: "deepseek",
        label: "DeepSeek V4 Pro",
        description: "Stronger DeepSeek model for harder tasks"
      }
    ]
  },
  openai: {
    id: "openai",
    label: "OpenAI",
    api: "openai-compatible",
    baseUrl: "https://api.openai.com/v1",
    apiKeyEnv: "OPENAI_API_KEY",
    supportsBalance: false,
    models: [
      {
        id: "gpt-5.4",
        provider: "openai",
        label: "GPT-5.4",
        description: "Premium fallback"
      },
      {
        id: "gpt-5.4-mini",
        provider: "openai",
        label: "GPT-5.4 Mini",
        description: "Lower-cost OpenAI fallback"
      }
    ]
  },
  google: {
    id: "google",
    label: "Google",
    api: "openai-compatible",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
    modelListUrl: "https://generativelanguage.googleapis.com/v1beta/models",
    apiKeyEnv: "GEMINI_API_KEY",
    supportsBalance: false,
    models: [
      {
        id: "gemini-2.5-flash",
        provider: "google",
        label: "Gemini 2.5 Flash",
        description: "Fast price-performance default"
      },
      {
        id: "gemini-2.5-pro",
        provider: "google",
        label: "Gemini 2.5 Pro",
        description: "Stronger Gemini reasoning model"
      },
      {
        id: "gemini-3-flash-preview",
        provider: "google",
        label: "Gemini 3 Flash Preview",
        description: "Preview balanced Gemini 3 model"
      },
      {
        id: "gemini-3-pro-preview",
        provider: "google",
        label: "Gemini 3 Pro Preview",
        description: "Preview frontier Gemini model"
      }
    ]
  },
  anthropic: {
    id: "anthropic",
    label: "Anthropic",
    api: "anthropic",
    baseUrl: "https://api.anthropic.com/v1",
    apiKeyEnv: "ANTHROPIC_API_KEY",
    supportsBalance: false,
    models: [
      {
        id: "claude-sonnet-4-20250514",
        provider: "anthropic",
        label: "Claude Sonnet 4",
        description: "Balanced Claude model for agent work"
      },
      {
        id: "claude-opus-4-1-20250805",
        provider: "anthropic",
        label: "Claude Opus 4.1",
        description: "Most capable Claude model in official docs"
      },
      {
        id: "claude-3-5-haiku-20241022",
        provider: "anthropic",
        label: "Claude Haiku 3.5",
        description: "Fast lower-cost Claude model"
      }
    ]
  },
  nvidia: {
    id: "nvidia",
    label: "NVIDIA",
    api: "openai-compatible",
    baseUrl: "https://integrate.api.nvidia.com/v1",
    apiKeyEnv: "NVIDIA_API_KEY",
    supportsBalance: false,
    models: [
      {
        id: "nvidia/llama-3.3-nemotron-super-49b-v1",
        provider: "nvidia",
        label: "Nemotron Super 49B",
        description: "NVIDIA quality-efficiency reasoning model"
      },
      {
        id: "nvidia/llama-3.1-nemotron-ultra-253b-v1",
        provider: "nvidia",
        label: "Nemotron Ultra 253B",
        description: "Large NVIDIA Nemotron model"
      },
      {
        id: "nvidia/llama-3.1-nemotron-51b-instruct",
        provider: "nvidia",
        label: "Nemotron 51B Instruct",
        description: "NVIDIA quality-per-dollar instruct model"
      },
      {
        id: "nvidia/llama-3.1-nemotron-nano-4b-v1.1",
        provider: "nvidia",
        label: "Nemotron Nano 4B",
        description: "Small fast NVIDIA model"
      },
      {
        id: "deepseek-ai/deepseek-r1",
        provider: "nvidia",
        label: "DeepSeek R1 on NVIDIA",
        description: "DeepSeek R1 served through NVIDIA NIM"
      }
    ]
  }
};

export function allModels(): ModelRef[] {
  return Object.values(providers).flatMap((provider) => provider.models);
}

export function findModel(modelId: string): ModelRef | undefined {
  return allModels().find((model) => model.id === modelId);
}

export async function listProviderModels(provider: Provider, apiKey: string): Promise<ModelRef[]> {
  if (!apiKey.trim()) {
    return provider.models;
  }

  try {
    if (provider.id === "google") {
      return await listGoogleModels(provider, apiKey);
    }

    if (provider.id === "anthropic") {
      return await listAnthropicModels(provider, apiKey);
    }

    return await listOpenAiCompatibleModels(provider, apiKey);
  } catch {
    return provider.models;
  }
}

export async function chatCompletion(input: {
  provider: Provider;
  model: string;
  messages: ChatMessage[];
  tools?: ToolDefinition[];
  mode: Mode;
  apiKey: string;
}): Promise<ChatResponse> {
  if (!input.apiKey.trim()) {
    throw new Error(`Missing ${input.provider.apiKeyEnv}.`);
  }

  if (input.provider.api === "anthropic") {
    return anthropicMessages(input);
  }

  const body: Record<string, unknown> = {
    model: input.model,
    messages: input.messages,
    stream: false
  };

  if (input.tools?.length) {
    body.tools = input.tools;
    body.tool_choice = "auto";
  }

  Object.assign(body, providerModelExtras(input.provider.id, input.model, input.mode));

  const response = await fetch(`${input.provider.baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${input.apiKey}`
    },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`${input.provider.label} request failed (${response.status}): ${text}`);
  }

  return (await response.json()) as ChatResponse;
}

async function anthropicMessages(input: {
  provider: Provider;
  model: string;
  messages: ChatMessage[];
  tools?: ToolDefinition[];
  mode: Mode;
  apiKey: string;
}): Promise<ChatResponse> {
  const {system, messages} = toAnthropicMessages(input.messages);
  const body: Record<string, unknown> = {
    model: input.model,
    max_tokens: 4096,
    system,
    messages
  };

  if (input.tools?.length) {
    body.tools = input.tools.map((tool) => ({
      name: tool.function.name,
      description: tool.function.description,
      input_schema: tool.function.parameters
    }));
  }

  const response = await fetch(`${input.provider.baseUrl}/messages`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": input.apiKey,
      "anthropic-version": "2023-06-01"
    },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`${input.provider.label} request failed (${response.status}): ${text}`);
  }

  const payload = (await response.json()) as {
    content?: Array<
      | {type: "text"; text: string}
      | {type: "tool_use"; id: string; name: string; input: unknown}
    >;
    stop_reason?: string;
    usage?: {
      input_tokens?: number;
      output_tokens?: number;
    };
  };

  const text = (payload.content ?? [])
    .filter((item): item is {type: "text"; text: string} => item.type === "text")
    .map((item) => item.text)
    .join("\n")
    .trim();
  const toolCalls = (payload.content ?? [])
    .filter((item): item is {type: "tool_use"; id: string; name: string; input: unknown} => item.type === "tool_use")
    .map((item) => ({
      id: item.id,
      type: "function" as const,
      function: {
        name: item.name,
        arguments: JSON.stringify(item.input ?? {})
      }
    }));

  return {
    choices: [
      {
        message: {
          content: text || null,
          tool_calls: toolCalls.length ? toolCalls : undefined
        },
        finish_reason: payload.stop_reason
      }
    ],
    usage: {
      prompt_tokens: payload.usage?.input_tokens,
      completion_tokens: payload.usage?.output_tokens,
      total_tokens: (payload.usage?.input_tokens ?? 0) + (payload.usage?.output_tokens ?? 0)
    }
  };
}

function toAnthropicMessages(messages: ChatMessage[]): {system: string; messages: unknown[]} {
  const system = messages
    .filter((message): message is {role: "system"; content: string} => message.role === "system")
    .map((message) => message.content)
    .join("\n\n");
  const converted: unknown[] = [];

  for (const message of messages) {
    if (message.role === "system") {
      continue;
    }

    if (message.role === "user") {
      converted.push({role: "user", content: message.content});
      continue;
    }

    if (message.role === "assistant") {
      const content: unknown[] = [];
      if (message.content) {
        content.push({type: "text", text: message.content});
      }
      for (const toolCall of message.tool_calls ?? []) {
        content.push({
          type: "tool_use",
          id: toolCall.id,
          name: toolCall.function.name,
          input: safeJson(toolCall.function.arguments)
        });
      }
      converted.push({role: "assistant", content});
      continue;
    }

    converted.push({
      role: "user",
      content: [
        {
          type: "tool_result",
          tool_use_id: message.tool_call_id,
          content: message.content
        }
      ]
    });
  }

  return {system, messages: converted};
}

export async function getBalance(provider: Provider, apiKey: string): Promise<string> {
  if (provider.id !== "deepseek") {
    return `${provider.label} does not expose balance through this MVP.`;
  }

  const response = await fetch(`${provider.baseUrl}/user/balance`, {
    headers: {
      authorization: `Bearer ${apiKey}`
    }
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`${provider.label} balance failed (${response.status}): ${text}`);
  }

  const payload = (await response.json()) as {
    is_available?: boolean;
    balance_infos?: Array<{
      currency?: string;
      total_balance?: string;
      granted_balance?: string;
      topped_up_balance?: string;
    }>;
  };

  const lines = [`Provider: ${provider.label}`, `Available: ${payload.is_available ? "yes" : "no"}`];

  for (const info of payload.balance_infos ?? []) {
    lines.push(
      `${info.currency ?? "balance"}: ${info.total_balance ?? "unknown"} total`,
      `  granted: ${info.granted_balance ?? "unknown"}`,
      `  topped up: ${info.topped_up_balance ?? "unknown"}`
    );
  }

  return lines.join("\n");
}

async function listOpenAiCompatibleModels(provider: Provider, apiKey: string): Promise<ModelRef[]> {
  const response = await fetch(`${provider.baseUrl}/models`, {
    headers: {
      authorization: `Bearer ${apiKey}`
    }
  });

  if (!response.ok) {
    throw new Error(`Failed to list ${provider.label} models.`);
  }

  const payload = (await response.json()) as {
    data?: Array<{id?: string; object?: string; owned_by?: string}>;
  };

  const models = uniqueModelIds((payload.data ?? []).map((model) => model.id))
    .filter((id) => shouldShowModel(provider, id))
    .map((id) => modelRef(provider.id, id, provider.models));

  return models.length ? models : provider.models;
}

async function listAnthropicModels(provider: Provider, apiKey: string): Promise<ModelRef[]> {
  const response = await fetch(`${provider.baseUrl}/models`, {
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01"
    }
  });

  if (!response.ok) {
    throw new Error(`Failed to list ${provider.label} models.`);
  }

  const payload = (await response.json()) as {
    data?: Array<{id?: string; display_name?: string}>;
  };

  const models = uniqueModelIds((payload.data ?? []).map((model) => model.id))
    .map((id) => modelRef(provider.id, id, provider.models));

  return models.length ? models : provider.models;
}

async function listGoogleModels(provider: Provider, apiKey: string): Promise<ModelRef[]> {
  const response = await fetch(`${provider.modelListUrl}?key=${encodeURIComponent(apiKey)}`);

  if (!response.ok) {
    throw new Error(`Failed to list ${provider.label} models.`);
  }

  const payload = (await response.json()) as {
    models?: Array<{name?: string; supportedGenerationMethods?: string[]}>;
  };

  const models = uniqueModelIds(
    (payload.models ?? [])
      .filter((model) => model.supportedGenerationMethods?.includes("generateContent"))
      .map((model) => model.name?.replace(/^models\//, ""))
  )
    .filter((id) => id.startsWith("gemini-"))
    .map((id) => modelRef(provider.id, id, provider.models));

  return models.length ? models : provider.models;
}

function uniqueModelIds(ids: Array<string | undefined>): string[] {
  return [...new Set(ids.filter((id): id is string => Boolean(id)))].sort();
}

function modelRef(providerId: ProviderId, id: string, fallbackModels: ModelRef[]): ModelRef {
  const known = fallbackModels.find((model) => model.id === id);
  if (known) {
    return known;
  }

  return {
    id,
    provider: providerId,
    label: id,
    description: "Available from provider"
  };
}

function shouldShowModel(provider: Provider, id: string): boolean {
  if (provider.id === "openai") {
    return id.startsWith("gpt-") || id.startsWith("o") || id.startsWith("chatgpt-");
  }

  return true;
}

function providerModelExtras(providerId: ProviderId, model: string, mode: Mode): Record<string, unknown> {
  if (providerId !== "deepseek") {
    return {};
  }

  if (model === "deepseek-v4-flash") {
    return {
      thinking: {type: "disabled"}
    };
  }

  if (model === "deepseek-v4-pro" && mode === "act") {
    return {
      thinking: {type: "enabled"},
      reasoning_effort: "high"
    };
  }

  return {};
}

function safeJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return {};
  }
}
