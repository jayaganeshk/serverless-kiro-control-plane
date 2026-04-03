import type {
  APIGatewayProxyEvent,
  APIGatewayProxyResult,
} from "aws-lambda";
import {
  BedrockRuntimeClient,
  ConverseCommand,
  type Message,
  type SystemContentBlock,
} from "@aws-sdk/client-bedrock-runtime";
import type { AIAgentConfig, AIAgentCategory, KiroAgentConfig } from "@remote-kiro/common";
import { normalizeEvent } from "../middleware/event-adapter.js";
import { createRequestLogger } from "../middleware/logger.js";
import { validateCognitoJwt } from "../middleware/auth.js";
import { parseJsonBody, requireFields } from "../middleware/request-parser.js";
import {
  buildSuccessResponse,
  buildErrorResponse,
  ValidationError,
  NotFoundError,
} from "../middleware/error-handler.js";
import {
  createAIAgent,
  getAIAgentById,
  listAllAIAgents,
  updateAIAgent,
  deleteAIAgent,
  seedDefaultAgents,
} from "../db/ai-agents.js";

const MODEL_ID = process.env.BEDROCK_MODEL_ID ?? "amazon.nova-lite-v1:0";
const REGION = process.env.BEDROCK_REGION ?? process.env.AWS_REGION ?? "us-east-1";
const bedrock = new BedrockRuntimeClient({ region: REGION });

const VALID_CATEGORIES: AIAgentCategory[] = [
  "ui_frontend", "backend", "python", "aws_serverless",
  "fullstack", "code_review", "security_review", "custom",
];

// ─── Curated MCP Server Registry ───

export interface McpRegistryEntry {
  id: string;
  name: string;
  description: string;
  category: string;
  command: string;
  args: string[];
  env?: Record<string, string>;
  relevantFor: string[];
  tools: string[];
}

const MCP_REGISTRY: McpRegistryEntry[] = [
  {
    id: "awslabs.aws-documentation-mcp-server",
    name: "AWS Documentation",
    description: "Search, read, and get recommendations from official AWS documentation",
    category: "Documentation",
    command: "uvx",
    args: ["awslabs.aws-documentation-mcp-server@latest"],
    env: { FASTMCP_LOG_LEVEL: "ERROR", AWS_DOCUMENTATION_PARTITION: "aws" },
    relevantFor: ["aws_serverless", "backend", "fullstack", "python"],
    tools: ["search_documentation", "read_documentation", "read_sections", "recommend"],
  },
  {
    id: "awslabs.aws-serverless-mcp-server",
    name: "AWS Serverless (SAM)",
    description: "Complete serverless application lifecycle management with SAM CLI",
    category: "Infrastructure",
    command: "uvx",
    args: ["awslabs.aws-serverless-mcp-server@latest"],
    env: { FASTMCP_LOG_LEVEL: "ERROR" },
    relevantFor: ["aws_serverless", "backend"],
    tools: ["sam_init", "sam_build", "sam_deploy", "sam_local_invoke"],
  },
  {
    id: "awslabs.cdk-mcp-server",
    name: "AWS CDK",
    description: "AWS CDK development with security compliance checks and best practices",
    category: "Infrastructure",
    command: "uvx",
    args: ["awslabs.cdk-mcp-server@latest"],
    env: { FASTMCP_LOG_LEVEL: "ERROR" },
    relevantFor: ["aws_serverless", "backend", "fullstack"],
    tools: ["cdk_init", "cdk_synth", "cdk_deploy", "cdk_diff"],
  },
  {
    id: "awslabs.cfn-mcp-server",
    name: "AWS CloudFormation",
    description: "Direct CloudFormation resource management via Cloud Control API",
    category: "Infrastructure",
    command: "uvx",
    args: ["awslabs.cfn-mcp-server@latest"],
    env: { FASTMCP_LOG_LEVEL: "ERROR" },
    relevantFor: ["aws_serverless", "backend"],
    tools: ["cfn_deploy", "cfn_validate", "cfn_lint"],
  },
  {
    id: "awslabs.terraform-mcp-server",
    name: "AWS Terraform",
    description: "Terraform workflows with integrated security scanning for AWS resources",
    category: "Infrastructure",
    command: "uvx",
    args: ["awslabs.terraform-mcp-server@latest"],
    env: { FASTMCP_LOG_LEVEL: "ERROR" },
    relevantFor: ["aws_serverless", "backend", "fullstack"],
    tools: ["terraform_init", "terraform_plan", "terraform_apply"],
  },
  {
    id: "awslabs.dynamodb-mcp-server",
    name: "Amazon DynamoDB",
    description: "Complete DynamoDB operations, table management, and query optimization",
    category: "Data & Analytics",
    command: "uvx",
    args: ["awslabs.dynamodb-mcp-server@latest"],
    env: { FASTMCP_LOG_LEVEL: "ERROR" },
    relevantFor: ["aws_serverless", "backend", "fullstack"],
    tools: ["dynamodb_query", "dynamodb_put_item", "dynamodb_scan"],
  },
  {
    id: "awslabs.postgres-mcp-server",
    name: "Aurora PostgreSQL",
    description: "PostgreSQL database operations via RDS Data API",
    category: "Data & Analytics",
    command: "uvx",
    args: ["awslabs.postgres-mcp-server@latest"],
    env: { FASTMCP_LOG_LEVEL: "ERROR" },
    relevantFor: ["backend", "fullstack", "python"],
    tools: ["postgres_query", "postgres_describe_table"],
  },
  {
    id: "awslabs.frontend-mcp-server",
    name: "Frontend Development",
    description: "React and modern web development guidance, component patterns, and best practices",
    category: "Developer Tools",
    command: "uvx",
    args: ["awslabs.frontend-mcp-server@latest"],
    env: { FASTMCP_LOG_LEVEL: "ERROR" },
    relevantFor: ["ui_frontend", "fullstack"],
    tools: ["frontend_guidance", "component_patterns"],
  },
  {
    id: "awslabs.git-repo-research-mcp-server",
    name: "Git Repo Research",
    description: "Semantic code search and repository analysis for understanding codebases",
    category: "Developer Tools",
    command: "uvx",
    args: ["awslabs.git-repo-research-mcp-server@latest"],
    env: { FASTMCP_LOG_LEVEL: "ERROR" },
    relevantFor: ["code_review", "security_review", "fullstack"],
    tools: ["search_code", "analyze_repo"],
  },
  {
    id: "awslabs.code-doc-gen-mcp-server",
    name: "Code Documentation Generator",
    description: "Automated documentation generation from code analysis",
    category: "Developer Tools",
    command: "uvx",
    args: ["awslabs.code-doc-gen-mcp-server@latest"],
    env: { FASTMCP_LOG_LEVEL: "ERROR" },
    relevantFor: ["code_review", "backend", "fullstack"],
    tools: ["generate_docs", "analyze_code"],
  },
  {
    id: "awslabs.aws-diagram-mcp-server",
    name: "AWS Architecture Diagrams",
    description: "Generate architecture diagrams and technical illustrations",
    category: "Developer Tools",
    command: "uvx",
    args: ["awslabs.aws-diagram-mcp-server@latest"],
    env: { FASTMCP_LOG_LEVEL: "ERROR" },
    relevantFor: ["aws_serverless", "fullstack"],
    tools: ["generate_diagram"],
  },
  {
    id: "awslabs.eks-mcp-server",
    name: "Amazon EKS",
    description: "Kubernetes cluster management and application deployment on EKS",
    category: "Infrastructure",
    command: "uvx",
    args: ["awslabs.eks-mcp-server@latest"],
    env: { FASTMCP_LOG_LEVEL: "ERROR" },
    relevantFor: ["backend", "fullstack"],
    tools: ["eks_list_clusters", "eks_describe_cluster"],
  },
  {
    id: "awslabs.ecs-mcp-server",
    name: "Amazon ECS",
    description: "Container orchestration and ECS application deployment",
    category: "Infrastructure",
    command: "uvx",
    args: ["awslabs.ecs-mcp-server@latest"],
    env: { FASTMCP_LOG_LEVEL: "ERROR" },
    relevantFor: ["backend", "fullstack"],
    tools: ["ecs_list_services", "ecs_deploy"],
  },
  {
    id: "awslabs.cloudwatch-mcp-server",
    name: "Amazon CloudWatch",
    description: "Metrics, alarms, and logs analysis for operational troubleshooting",
    category: "Operations",
    command: "uvx",
    args: ["awslabs.cloudwatch-mcp-server@latest"],
    env: { FASTMCP_LOG_LEVEL: "ERROR" },
    relevantFor: ["aws_serverless", "backend"],
    tools: ["get_metrics", "query_logs", "describe_alarms"],
  },
  {
    id: "awslabs.iam-mcp-server",
    name: "AWS IAM",
    description: "IAM user, role, group, and policy management with security best practices",
    category: "Security",
    command: "uvx",
    args: ["awslabs.iam-mcp-server@latest"],
    env: { FASTMCP_LOG_LEVEL: "ERROR" },
    relevantFor: ["security_review", "aws_serverless", "backend"],
    tools: ["iam_list_roles", "iam_analyze_policy"],
  },
  {
    id: "awslabs.amazon-sns-sqs-mcp-server",
    name: "Amazon SNS/SQS",
    description: "Event-driven messaging and queue management",
    category: "Integration",
    command: "uvx",
    args: ["awslabs.amazon-sns-sqs-mcp-server@latest"],
    env: { FASTMCP_LOG_LEVEL: "ERROR" },
    relevantFor: ["aws_serverless", "backend"],
    tools: ["sqs_send_message", "sns_publish"],
  },
  {
    id: "awslabs.cost-explorer-mcp-server",
    name: "AWS Cost Explorer",
    description: "Detailed cost analysis, reporting, and optimization recommendations",
    category: "Cost & Operations",
    command: "uvx",
    args: ["awslabs.cost-explorer-mcp-server@latest"],
    env: { FASTMCP_LOG_LEVEL: "ERROR" },
    relevantFor: ["aws_serverless", "backend", "fullstack"],
    tools: ["get_cost_and_usage", "get_cost_forecast"],
  },
];

// ─── Community / Ecosystem MCP Servers ───

const COMMUNITY_REGISTRY: McpRegistryEntry[] = [
  {
    id: "@vuetify/mcp",
    name: "Vuetify MCP",
    description: "Official Vuetify MCP server with component docs, API references, patterns, and composables for Vuetify 3/4",
    category: "Frontend",
    command: "npx",
    args: ["-y", "@vuetify/mcp"],
    relevantFor: ["ui_frontend", "fullstack"],
    tools: ["get_component_api", "get_component_guide", "get_composable_list"],
  },
  {
    id: "vite-plugin-vue-mcp",
    name: "Vue DevTools MCP",
    description: "Exposes Vue app insights: component tree, state, routes, and Pinia store data through Vite dev server",
    category: "Frontend",
    command: "npx",
    args: ["-y", "vite-plugin-vue-mcp"],
    relevantFor: ["ui_frontend", "fullstack"],
    tools: ["get_component_tree", "get_pinia_state", "get_routes"],
  },
  {
    id: "nuxt-mcp",
    name: "Nuxt MCP",
    description: "MCP server for Nuxt.js applications with module info, route analysis, and Nuxt-specific development tools",
    category: "Frontend",
    command: "npx",
    args: ["-y", "@anthropic/nuxt-mcp"],
    relevantFor: ["ui_frontend", "fullstack"],
    tools: ["get_nuxt_config", "list_modules", "analyze_routes"],
  },
  {
    id: "@anthropic/context7-mcp",
    name: "Context7",
    description: "Up-to-date documentation lookup for any library or framework. Resolves library IDs and queries latest docs with code examples",
    category: "Documentation",
    command: "npx",
    args: ["-y", "@upstash/context7-mcp@latest"],
    relevantFor: ["ui_frontend", "backend", "python", "fullstack", "aws_serverless"],
    tools: ["resolve_library_id", "get_library_docs"],
  },
  {
    id: "21st-dev-magic-mcp",
    name: "21st.dev Magic",
    description: "Create crafted UI components inspired by top design engineers. Generates production-ready React/Vue components",
    category: "Frontend",
    command: "npx",
    args: ["-y", "@21st-dev/magic-mcp@latest"],
    relevantFor: ["ui_frontend", "fullstack"],
    tools: ["create_component", "get_inspiration"],
  },
  {
    id: "github-mcp-server",
    name: "GitHub",
    description: "GitHub's official MCP server for repo management, issues, PRs, code search, CI/CD, and team collaboration",
    category: "Version Control",
    command: "docker",
    args: ["run", "-i", "--rm", "-e", "GITHUB_PERSONAL_ACCESS_TOKEN", "ghcr.io/github/github-mcp-server"],
    env: { GITHUB_PERSONAL_ACCESS_TOKEN: "<your-token>" },
    relevantFor: ["backend", "fullstack", "code_review", "ui_frontend"],
    tools: ["search_repos", "create_issue", "create_pull_request", "get_file_contents"],
  },
  {
    id: "playwright-mcp",
    name: "Playwright",
    description: "Microsoft's official Playwright MCP server for browser automation, testing, screenshots, and web interaction",
    category: "Testing",
    command: "npx",
    args: ["-y", "@playwright/mcp@latest"],
    relevantFor: ["ui_frontend", "fullstack", "code_review"],
    tools: ["navigate", "click", "fill", "screenshot", "evaluate"],
  },
  {
    id: "a11y-mcp",
    name: "Accessibility Auditor",
    description: "Perform accessibility audits on webpages using axe-core engine to identify and fix WCAG compliance issues",
    category: "Testing",
    command: "npx",
    args: ["-y", "a11y-mcp-server"],
    relevantFor: ["ui_frontend", "fullstack", "code_review"],
    tools: ["audit_page", "check_contrast", "validate_aria"],
  },
  {
    id: "exa-mcp-server",
    name: "Exa Search",
    description: "AI-native search engine by Exa for finding relevant code, docs, and technical content on the web",
    category: "Search",
    command: "npx",
    args: ["-y", "exa-mcp-server"],
    env: { EXA_API_KEY: "<your-key>" },
    relevantFor: ["backend", "fullstack", "ui_frontend", "python"],
    tools: ["search", "find_similar", "get_contents"],
  },
  {
    id: "firecrawl-mcp",
    name: "Firecrawl",
    description: "Web scraping and search capabilities for extracting structured data from websites and documentation",
    category: "Search",
    command: "npx",
    args: ["-y", "firecrawl-mcp"],
    env: { FIRECRAWL_API_KEY: "<your-key>" },
    relevantFor: ["backend", "fullstack", "python"],
    tools: ["scrape_url", "crawl_site", "search_web"],
  },
  {
    id: "supabase-mcp",
    name: "Supabase",
    description: "Connect to Supabase for database operations, auth management, edge functions, and real-time subscriptions",
    category: "Database",
    command: "npx",
    args: ["-y", "@supabase/mcp-server"],
    relevantFor: ["backend", "fullstack"],
    tools: ["query_database", "manage_auth", "invoke_function"],
  },
  {
    id: "next-devtools-mcp",
    name: "Next.js DevTools",
    description: "Official Next.js development tools and utilities for AI coding assistants, including route analysis and config inspection",
    category: "Frontend",
    command: "npx",
    args: ["-y", "next-devtools-mcp"],
    relevantFor: ["ui_frontend", "fullstack"],
    tools: ["get_routes", "get_config", "analyze_bundle"],
  },
  {
    id: "tailwind-mcp",
    name: "Tailwind CSS",
    description: "Tailwind CSS utility class reference, component patterns, and design system guidance for AI assistants",
    category: "Frontend",
    command: "npx",
    args: ["-y", "tailwind-mcp-server"],
    relevantFor: ["ui_frontend", "fullstack"],
    tools: ["get_utility_classes", "suggest_design", "convert_css"],
  },
  {
    id: "prisma-mcp",
    name: "Prisma",
    description: "Prisma ORM MCP server for schema management, query building, and database migration assistance",
    category: "Database",
    command: "npx",
    args: ["-y", "prisma-mcp-server"],
    relevantFor: ["backend", "fullstack"],
    tools: ["generate_schema", "query_builder", "migrate"],
  },
  {
    id: "docker-mcp",
    name: "Docker",
    description: "Docker container management, image building, and compose orchestration through MCP",
    category: "Infrastructure",
    command: "npx",
    args: ["-y", "docker-mcp-server"],
    relevantFor: ["backend", "fullstack", "aws_serverless"],
    tools: ["list_containers", "build_image", "compose_up"],
  },
  {
    id: "eslint-mcp",
    name: "ESLint",
    description: "ESLint code quality analysis, auto-fix suggestions, and rule configuration for JavaScript/TypeScript projects",
    category: "Developer Tools",
    command: "npx",
    args: ["-y", "eslint-mcp-server"],
    relevantFor: ["ui_frontend", "backend", "fullstack"],
    tools: ["lint_file", "fix_issues", "get_rules"],
  },
];

function getRegistryEntries(): McpRegistryEntry[] {
  return [...MCP_REGISTRY, ...COMMUNITY_REGISTRY];
}

const GENERATE_SYSTEM_PROMPT = [
  "You are an expert at creating Kiro CLI agent configurations for software development tasks.",
  "Given a user's description of what kind of AI coding agent they want, generate a complete agent configuration.",
  "",
  "The configuration must be a valid JSON object with these fields:",
  '- "name": short kebab-case identifier (e.g., "vue-frontend-expert")',
  '- "description": one-line description of when to use this agent',
  '- "prompt": detailed system prompt for the agent (the core expertise and principles)',
  '- "tools": ["*"] (give access to all tools)',
  '- "allowedTools": ["read", "write", "shell"] (auto-approve common tools)',
  '- "mcpServers": (optional) MCP servers to give the agent external tool access',
  '- "includeMcpJson": false (whether to include workspace/global MCP config)',
  "",
  "The prompt should be detailed and specific, covering:",
  "- The agent's area of expertise",
  "- Key principles and best practices to follow",
  "- Coding standards and patterns",
  "- What to focus on and what to avoid",
  "",
  "Available MCP servers you can include in mcpServers:",
  '1. AWS Documentation MCP: { "command": "uvx", "args": ["awslabs.aws-documentation-mcp-server@latest"], "env": { "FASTMCP_LOG_LEVEL": "ERROR", "AWS_DOCUMENTATION_PARTITION": "aws" } }',
  "   - Provides: search_documentation, read_documentation, read_sections, recommend tools",
  "   - Use for: Any agent that works with AWS services",
  "   - When including, also add \"@awslabs.aws-documentation-mcp-server\" to allowedTools",
  "",
  "Only include MCP servers when they are relevant to the agent's purpose.",
  "For AWS-related agents, ALWAYS include the AWS Documentation MCP server.",
  "",
  "Return ONLY the JSON object. No markdown fences, no explanations.",
].join("\n");

const REFINE_PROMPT_SYSTEM = [
  "You are an expert at refining user descriptions into clear, professional agent descriptions.",
  "Take the user's rough description and improve it to be:",
  "- Clear and specific about what the agent specializes in",
  "- Professional and concise",
  "- Covering the key technologies, frameworks, and patterns",
  "",
  "Return ONLY the refined description. No explanations, no labels.",
].join("\n");

// ─── GET /ai-agents ───

async function handleList(
  _event: APIGatewayProxyEvent,
): Promise<APIGatewayProxyResult> {
  await seedDefaultAgents();
  const agents = await listAllAIAgents();
  return buildSuccessResponse(200, agents);
}

// ─── GET /ai-agents/{aiAgentId} ───

async function handleGet(
  event: APIGatewayProxyEvent,
): Promise<APIGatewayProxyResult> {
  const aiAgentId = event.pathParameters?.aiAgentId;
  if (!aiAgentId) throw new ValidationError("aiAgentId is required");

  const agent = await getAIAgentById(aiAgentId);
  if (!agent) throw new NotFoundError("AI Agent not found");

  return buildSuccessResponse(200, agent);
}

// ─── POST /ai-agents ───

async function handleCreate(
  event: APIGatewayProxyEvent,
): Promise<APIGatewayProxyResult> {
  const userId = await validateCognitoJwt(event);
  const body = parseJsonBody<Record<string, unknown>>(event);
  const { name, category, description, kiroConfig } = requireFields<{
    name: string;
    category: AIAgentCategory;
    description: string;
    kiroConfig: KiroAgentConfig;
  }>(body, ["name", "category", "description", "kiroConfig"]);

  if (!VALID_CATEGORIES.includes(category)) {
    throw new ValidationError(`Invalid category. Must be one of: ${VALID_CATEGORIES.join(", ")}`);
  }

  const now = new Date().toISOString();
  const agent: AIAgentConfig = {
    aiAgentId: crypto.randomUUID(),
    name,
    category,
    description,
    kiroConfig,
    isDefault: false,
    createdBy: userId,
    createdAt: now,
    updatedAt: now,
  };

  await createAIAgent(agent);
  return buildSuccessResponse(201, agent);
}

// ─── PATCH /ai-agents/{aiAgentId} ───

async function handleUpdate(
  event: APIGatewayProxyEvent,
): Promise<APIGatewayProxyResult> {
  const aiAgentId = event.pathParameters?.aiAgentId;
  if (!aiAgentId) throw new ValidationError("aiAgentId is required");

  const existing = await getAIAgentById(aiAgentId);
  if (!existing) throw new NotFoundError("AI Agent not found");

  const body = parseJsonBody<Record<string, unknown>>(event);
  const fields: Partial<Pick<AIAgentConfig, "name" | "category" | "description" | "kiroConfig">> = {};

  if (body.name !== undefined) fields.name = body.name as string;
  if (body.category !== undefined) {
    if (!VALID_CATEGORIES.includes(body.category as AIAgentCategory)) {
      throw new ValidationError(`Invalid category. Must be one of: ${VALID_CATEGORIES.join(", ")}`);
    }
    fields.category = body.category as AIAgentCategory;
  }
  if (body.description !== undefined) fields.description = body.description as string;
  if (body.kiroConfig !== undefined) fields.kiroConfig = body.kiroConfig as KiroAgentConfig;

  const updated = await updateAIAgent(aiAgentId, fields);
  return buildSuccessResponse(200, updated);
}

// ─── DELETE /ai-agents/{aiAgentId} ───

async function handleDelete(
  event: APIGatewayProxyEvent,
): Promise<APIGatewayProxyResult> {
  const aiAgentId = event.pathParameters?.aiAgentId;
  if (!aiAgentId) throw new ValidationError("aiAgentId is required");

  const existing = await getAIAgentById(aiAgentId);
  if (!existing) throw new NotFoundError("AI Agent not found");
  if (existing.isDefault) {
    throw new ValidationError("Cannot delete default agents");
  }

  await deleteAIAgent(aiAgentId);
  return buildSuccessResponse(200, { deleted: true });
}

// ─── POST /ai-agents/generate ───

async function handleGenerate(
  event: APIGatewayProxyEvent,
): Promise<APIGatewayProxyResult> {
  const userId = await validateCognitoJwt(event);
  const body = parseJsonBody<Record<string, unknown>>(event);
  const prompt = body.prompt as string | undefined;
  const category = (body.category as AIAgentCategory) || "custom";

  if (!prompt?.trim()) {
    throw new ValidationError("prompt is required — describe what kind of agent you want");
  }

  const system: SystemContentBlock[] = [{ text: GENERATE_SYSTEM_PROMPT }];
  const messages: Message[] = [
    {
      role: "user",
      content: [{
        text: `Create a Kiro agent configuration for: ${prompt.trim()}\n\nCategory: ${category}`,
      }],
    },
  ];

  const response = await bedrock.send(
    new ConverseCommand({
      modelId: MODEL_ID,
      system,
      messages,
      inferenceConfig: {
        maxTokens: 4096,
        temperature: 0.4,
        topP: 0.9,
      },
    }),
  );

  const rawText = response.output?.message?.content?.[0]?.text ?? "{}";

  let kiroConfig: KiroAgentConfig;
  try {
    const cleaned = rawText.replace(/```json?\n?/g, "").replace(/```/g, "").trim();
    kiroConfig = JSON.parse(cleaned) as KiroAgentConfig;
  } catch {
    kiroConfig = {
      name: "custom-agent",
      description: prompt.trim(),
      prompt: prompt.trim(),
      tools: ["*"],
      allowedTools: ["read", "write", "shell"],
    };
  }

  if (!kiroConfig.tools) kiroConfig.tools = ["*"];
  if (!kiroConfig.allowedTools) kiroConfig.allowedTools = ["read", "write", "shell"];

  const now = new Date().toISOString();
  const agent: AIAgentConfig = {
    aiAgentId: crypto.randomUUID(),
    name: kiroConfig.name || "Custom Agent",
    category,
    description: kiroConfig.description || prompt.trim(),
    kiroConfig,
    isDefault: false,
    createdBy: userId,
    createdAt: now,
    updatedAt: now,
  };

  await createAIAgent(agent);
  return buildSuccessResponse(201, agent);
}

// ─── POST /ai-agents/refine-prompt ───

async function handleRefinePrompt(
  event: APIGatewayProxyEvent,
): Promise<APIGatewayProxyResult> {
  const body = parseJsonBody<Record<string, unknown>>(event);
  const prompt = body.prompt as string | undefined;

  if (!prompt?.trim()) {
    throw new ValidationError("prompt is required");
  }

  const system: SystemContentBlock[] = [{ text: REFINE_PROMPT_SYSTEM }];
  const messages: Message[] = [
    { role: "user", content: [{ text: prompt.trim() }] },
  ];

  const response = await bedrock.send(
    new ConverseCommand({
      modelId: MODEL_ID,
      system,
      messages,
      inferenceConfig: {
        maxTokens: 1024,
        temperature: 0.3,
        topP: 0.9,
      },
    }),
  );

  const refined = response.output?.message?.content?.[0]?.text ?? prompt;
  return buildSuccessResponse(200, { original: prompt, refined });
}

// ─── GET /ai-agents/mcp-registry ───

async function handleMcpRegistry(
  _event: APIGatewayProxyEvent,
): Promise<APIGatewayProxyResult> {
  return buildSuccessResponse(200, getRegistryEntries());
}

// ─── POST /ai-agents/suggest-mcp ───

const ALL_REGISTRY = [...MCP_REGISTRY, ...COMMUNITY_REGISTRY];

const SUGGEST_MCP_SYSTEM = [
  "You are an expert at recommending MCP (Model Context Protocol) servers for AI coding agents.",
  "Given an agent description and optionally its category, suggest the most relevant MCP servers.",
  "",
  "IMPORTANT: There are 7000+ MCP servers in the ecosystem (see mcpservers.org).",
  "Your job is to suggest the BEST matches from our curated registry AND from your knowledge of the broader ecosystem.",
  "",
  "== Curated Registry (prefer these — users can add them with one click) ==",
  ...ALL_REGISTRY.map(
    (s) => `- ${s.id}: ${s.description} [${s.category}] [for: ${s.relevantFor.join(",")}]`,
  ),
  "",
  "== Broader Ecosystem (suggest these as custom if highly relevant) ==",
  "You also know about thousands of MCP servers from mcpservers.org including:",
  "- Framework-specific: Vue.js (@vuetify/mcp, vite-plugin-vue-mcp), React (next-devtools-mcp), Angular, Svelte",
  "- UI/Design: Figma MCP, Storybook MCP, 21st.dev Magic",
  "- Databases: MongoDB, Redis, PostgreSQL, MySQL, SQLite MCP servers",
  "- Cloud: Vercel, Netlify, Cloudflare Workers, Firebase MCP servers",
  "- Testing: Playwright, Cypress, Jest, Vitest MCP servers",
  "- DevOps: Docker, Kubernetes, GitHub Actions, CI/CD MCP servers",
  "- Search/AI: Exa, Firecrawl, Perplexity, Tavily MCP servers",
  "- Docs: Context7 (any library docs), MDN, DevDocs MCP servers",
  "",
  "MATCHING RULES:",
  "1. For Vue.js agents → ALWAYS suggest @vuetify/mcp, vite-plugin-vue-mcp, Context7",
  "2. For React agents → ALWAYS suggest next-devtools-mcp, Context7, 21st.dev Magic",
  "3. For AWS agents → ALWAYS suggest AWS Documentation MCP",
  "4. For any frontend → suggest Playwright for testing, a11y-mcp for accessibility",
  "5. For any backend → suggest relevant database MCPs, Docker",
  "6. ALWAYS include Context7 for any framework-specific agent (it has docs for everything)",
  "",
  "Return a JSON array of suggestions. Each object must have:",
  '- "id": the registry ID (exact match) or a descriptive ID for ecosystem servers',
  '- "reason": one-sentence explanation of why this server is useful for the agent',
  '- "priority": "high" | "medium" | "low"',
  '- "isCustom": false for registry servers, true for ecosystem suggestions not in the registry',
  '- "name": human-readable name',
  '- "description": short description (for custom suggestions)',
  '- "command": the command to run (required for custom)',
  '- "args": array of arguments (required for custom)',
  "",
  "Return 4-8 suggestions, sorted by priority (high first).",
  "Return ONLY the JSON array. No markdown fences, no explanation.",
].join("\n");

async function handleSuggestMcp(
  event: APIGatewayProxyEvent,
): Promise<APIGatewayProxyResult> {
  const body = parseJsonBody<Record<string, unknown>>(event);
  const description = body.description as string | undefined;
  const agentCategory = body.category as string | undefined;
  const currentMcpIds = (body.currentMcpIds as string[] | undefined) ?? [];

  if (!description?.trim()) {
    throw new ValidationError("description is required — describe the agent's purpose");
  }

  const userText = [
    `Agent description: ${description.trim()}`,
    agentCategory ? `Category: ${agentCategory}` : "",
    currentMcpIds.length > 0 ? `Already configured MCPs: ${currentMcpIds.join(", ")}` : "",
    "Suggest MCP servers that would enhance this agent's capabilities.",
  ]
    .filter(Boolean)
    .join("\n");

  const system: SystemContentBlock[] = [{ text: SUGGEST_MCP_SYSTEM }];
  const messages: Message[] = [{ role: "user", content: [{ text: userText }] }];

  const response = await bedrock.send(
    new ConverseCommand({
      modelId: MODEL_ID,
      system,
      messages,
      inferenceConfig: { maxTokens: 2048, temperature: 0.3, topP: 0.9 },
    }),
  );

  const rawText = response.output?.message?.content?.[0]?.text ?? "[]";

  let suggestions: unknown[];
  try {
    const cleaned = rawText.replace(/```json?\n?/g, "").replace(/```/g, "").trim();
    suggestions = JSON.parse(cleaned);
    if (!Array.isArray(suggestions)) suggestions = [];
  } catch {
    suggestions = [];
  }

  const allEntries = getRegistryEntries();
  const enriched = suggestions.map((s: unknown) => {
    const sug = s as Record<string, unknown>;
    const registryEntry = allEntries.find((r) => r.id === sug.id);
    if (registryEntry && !sug.isCustom) {
      return {
        ...sug,
        name: registryEntry.name,
        description: registryEntry.description,
        category: registryEntry.category,
        command: registryEntry.command,
        args: registryEntry.args,
        env: registryEntry.env,
        tools: registryEntry.tools,
        isCustom: false,
      };
    }
    return { ...sug, isCustom: sug.isCustom ?? !registryEntry };
  });

  return buildSuccessResponse(200, { suggestions: enriched, registry: allEntries });
}

// ─── Router ───

export async function handler(
  rawEvent: unknown,
): Promise<APIGatewayProxyResult> {
  const event = normalizeEvent(rawEvent as Record<string, unknown>);
  const logger = createRequestLogger(event);
  try {
    const method = event.httpMethod;
    const path = event.path ?? "";

    logger.info("AIAgent handler invoked", { method, path });

    if (method === "GET" && path.endsWith("/ai-agents/mcp-registry")) {
      return await handleMcpRegistry(event);
    }
    if (method === "POST" && path.endsWith("/ai-agents/suggest-mcp")) {
      return await handleSuggestMcp(event);
    }
    if (method === "GET" && path.match(/\/ai-agents\/[^/]+$/)) {
      return await handleGet(event);
    }
    if (method === "GET" && path.endsWith("/ai-agents")) {
      return await handleList(event);
    }
    if (method === "POST" && path.endsWith("/ai-agents/generate")) {
      return await handleGenerate(event);
    }
    if (method === "POST" && path.endsWith("/ai-agents/refine-prompt")) {
      return await handleRefinePrompt(event);
    }
    if (method === "POST" && path.endsWith("/ai-agents")) {
      return await handleCreate(event);
    }
    if (method === "PATCH" && path.match(/\/ai-agents\/[^/]+$/)) {
      return await handleUpdate(event);
    }
    if (method === "DELETE" && path.match(/\/ai-agents\/[^/]+$/)) {
      return await handleDelete(event);
    }

    return buildSuccessResponse(404, {
      error: { code: "NOT_FOUND", message: "Route not found" },
    });
  } catch (err) {
    logger.error("AIAgent handler error", { error: (err as Error).message });
    return buildErrorResponse(err as Error);
  }
}
