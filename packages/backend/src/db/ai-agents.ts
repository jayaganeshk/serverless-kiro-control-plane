import {
  PutCommand,
  GetCommand,
  QueryCommand,
  UpdateCommand,
  DeleteCommand,
} from "@aws-sdk/lib-dynamodb";
import type { AIAgentConfig, KiroAgentConfig } from "@remote-kiro/common";
import { docClient, TABLE } from "./client.js";

function toItem(agent: AIAgentConfig) {
  return {
    PK: `AIAGENT#${agent.aiAgentId}`,
    SK: "AIAGENT",
    GSI2PK: "AIAGENTS",
    GSI2SK: agent.createdAt,
    ...agent,
  };
}

export async function createAIAgent(agent: AIAgentConfig): Promise<void> {
  await docClient.send(
    new PutCommand({
      TableName: TABLE,
      Item: toItem(agent),
      ConditionExpression: "attribute_not_exists(PK)",
    }),
  );
}

export async function getAIAgentById(
  aiAgentId: string,
): Promise<AIAgentConfig | undefined> {
  const { Item } = await docClient.send(
    new GetCommand({
      TableName: TABLE,
      Key: { PK: `AIAGENT#${aiAgentId}`, SK: "AIAGENT" },
    }),
  );
  return Item as AIAgentConfig | undefined;
}

export async function listAllAIAgents(): Promise<AIAgentConfig[]> {
  const { Items } = await docClient.send(
    new QueryCommand({
      TableName: TABLE,
      IndexName: "GSI2",
      KeyConditionExpression: "GSI2PK = :pk",
      ExpressionAttributeValues: { ":pk": "AIAGENTS" },
      ScanIndexForward: false,
    }),
  );
  return (Items ?? []) as AIAgentConfig[];
}

export async function updateAIAgent(
  aiAgentId: string,
  fields: Partial<Pick<AIAgentConfig, "name" | "category" | "description" | "kiroConfig">>,
): Promise<AIAgentConfig> {
  const now = new Date().toISOString();
  const names: Record<string, string> = { "#updatedAt": "updatedAt" };
  const values: Record<string, unknown> = { ":updatedAt": now };
  const parts: string[] = ["#updatedAt = :updatedAt"];

  for (const [key, val] of Object.entries(fields)) {
    if (val !== undefined) {
      names[`#${key}`] = key;
      values[`:${key}`] = val;
      parts.push(`#${key} = :${key}`);
    }
  }

  const { Attributes } = await docClient.send(
    new UpdateCommand({
      TableName: TABLE,
      Key: { PK: `AIAGENT#${aiAgentId}`, SK: "AIAGENT" },
      UpdateExpression: `SET ${parts.join(", ")}`,
      ExpressionAttributeNames: names,
      ExpressionAttributeValues: values,
      ConditionExpression: "attribute_exists(PK)",
      ReturnValues: "ALL_NEW",
    }),
  );

  return Attributes as AIAgentConfig;
}

export async function deleteAIAgent(aiAgentId: string): Promise<void> {
  await docClient.send(
    new DeleteCommand({
      TableName: TABLE,
      Key: { PK: `AIAGENT#${aiAgentId}`, SK: "AIAGENT" },
      ConditionExpression: "attribute_exists(PK) AND isDefault = :false",
      ExpressionAttributeValues: { ":false": false },
    }),
  );
}

// Default agent configurations
const DEFAULT_AGENTS: Omit<AIAgentConfig, "aiAgentId" | "createdAt" | "updatedAt">[] = [
  {
    name: "React UI Developer",
    category: "ui_frontend",
    description: "Specialized in React, TypeScript, CSS, and modern frontend development with best UX practices.",
    isDefault: true,
    createdBy: "system",
    kiroConfig: {
      name: "react-ui-developer",
      description: "Expert React/TypeScript frontend developer specializing in modern UI development with best UX practices",
      prompt: [
        "You are an expert React and TypeScript frontend developer.",
        "You specialize in building modern, accessible, performant user interfaces.",
        "Follow these principles:",
        "- Use functional components with hooks",
        "- Implement proper TypeScript types, avoid 'any'",
        "- Follow accessibility best practices (WCAG 2.1 AA)",
        "- Write responsive CSS with modern layout techniques (Grid, Flexbox)",
        "- Use proper state management patterns",
        "- Write clean, maintainable component architecture",
        "- Optimize bundle size and rendering performance",
        "- Include proper error boundaries and loading states",
      ].join("\n"),
      tools: ["*"],
      allowedTools: ["read", "write", "shell"],
    },
  },
  {
    name: "Node.js Backend Developer",
    category: "backend",
    description: "Expert in Node.js, Express, APIs, databases, and server-side TypeScript development.",
    isDefault: true,
    createdBy: "system",
    kiroConfig: {
      name: "nodejs-backend-developer",
      description: "Expert Node.js/TypeScript backend developer for APIs, services, and server-side logic",
      prompt: [
        "You are an expert Node.js and TypeScript backend developer.",
        "You specialize in building robust, scalable server-side applications.",
        "Follow these principles:",
        "- Design RESTful APIs with proper HTTP semantics",
        "- Implement proper error handling and validation",
        "- Use TypeScript strictly, no 'any' types",
        "- Follow security best practices (input validation, auth, rate limiting)",
        "- Write efficient database queries and proper data modeling",
        "- Implement proper logging and monitoring",
        "- Use dependency injection and clean architecture patterns",
        "- Handle async operations properly with error propagation",
      ].join("\n"),
      tools: ["*"],
      allowedTools: ["read", "write", "shell"],
    },
  },
  {
    name: "Python Developer",
    category: "python",
    description: "Specialized in Python development including Django, FastAPI, data processing, and scripting.",
    isDefault: true,
    createdBy: "system",
    kiroConfig: {
      name: "python-developer",
      description: "Expert Python developer for web frameworks, data processing, scripting, and automation",
      prompt: [
        "You are an expert Python developer.",
        "You specialize in building robust Python applications across web, data, and automation domains.",
        "Follow these principles:",
        "- Write Pythonic, PEP 8 compliant code",
        "- Use type hints consistently",
        "- Follow SOLID principles and clean architecture",
        "- Use virtual environments and proper dependency management",
        "- Write comprehensive tests with pytest",
        "- Handle exceptions properly with specific exception types",
        "- Use async/await where appropriate for I/O-bound operations",
        "- Document functions with proper docstrings",
      ].join("\n"),
      tools: ["*"],
      allowedTools: ["read", "write", "shell"],
    },
  },
  {
    name: "AWS Serverless Developer",
    category: "aws_serverless",
    description: "Expert in AWS Lambda, API Gateway, DynamoDB, S3, CDK/SAM, and serverless architecture patterns.",
    isDefault: true,
    createdBy: "system",
    kiroConfig: {
      name: "aws-serverless-developer",
      description: "Expert AWS serverless developer specializing in Lambda, API Gateway, DynamoDB, and infrastructure as code",
      prompt: [
        "You are an expert AWS serverless developer.",
        "You specialize in building scalable, cost-effective cloud-native applications.",
        "Use the AWS Documentation MCP server to look up current best practices and API details.",
        "Follow these principles:",
        "- Design with serverless-first architecture patterns",
        "- Use DynamoDB single-table design for data modeling",
        "- Implement proper IAM policies with least-privilege access",
        "- Use SAM/CDK for infrastructure as code",
        "- Handle Lambda cold starts and optimize memory/timeout settings",
        "- Implement proper error handling with DLQs and retry policies",
        "- Use environment variables for configuration, never hardcode secrets",
        "- Design for idempotency in event-driven architectures",
        "- Monitor with CloudWatch metrics, alarms, and X-Ray tracing",
      ].join("\n"),
      tools: ["*"],
      allowedTools: ["read", "write", "shell", "@awslabs.aws-documentation-mcp-server"],
      mcpServers: {
        "awslabs.aws-documentation-mcp-server": {
          command: "uvx",
          args: ["awslabs.aws-documentation-mcp-server@latest"],
          env: {
            FASTMCP_LOG_LEVEL: "ERROR",
            AWS_DOCUMENTATION_PARTITION: "aws",
          },
        },
      },
      includeMcpJson: false,
    },
  },
  {
    name: "Full Stack Developer",
    category: "fullstack",
    description: "Versatile developer covering both frontend and backend, great for general feature implementation.",
    isDefault: true,
    createdBy: "system",
    kiroConfig: {
      name: "fullstack-developer",
      description: "Versatile full-stack developer for end-to-end feature implementation",
      prompt: [
        "You are an expert full-stack developer comfortable with both frontend and backend.",
        "You can work across the entire application stack efficiently.",
        "Follow these principles:",
        "- Consider the full request lifecycle from UI to database",
        "- Maintain consistent API contracts between frontend and backend",
        "- Write proper TypeScript types shared across the stack",
        "- Implement proper error handling at every layer",
        "- Consider performance, security, and UX holistically",
        "- Use modern tooling and best practices for both sides",
        "- Write tests at unit, integration, and E2E levels",
      ].join("\n"),
      tools: ["*"],
      allowedTools: ["read", "write", "shell"],
    },
  },
  {
    name: "Code Reviewer",
    category: "code_review",
    description: "Thorough code reviewer focused on quality, security, performance, and maintainability.",
    isDefault: true,
    createdBy: "system",
    kiroConfig: {
      name: "code-reviewer",
      description: "Thorough code reviewer analyzing code quality, security vulnerabilities, performance, and best practices",
      prompt: [
        "You are an expert code reviewer with deep experience across multiple languages and frameworks.",
        "Review code changes thoroughly with focus on:",
        "- Security vulnerabilities (injection, auth flaws, exposed secrets, OWASP Top 10)",
        "- Performance issues (N+1 queries, memory leaks, unnecessary re-renders)",
        "- Code quality (naming, structure, DRY, SOLID principles)",
        "- Error handling (missing try-catch, unhandled promises, edge cases)",
        "- Type safety (proper TypeScript usage, no 'any' types)",
        "- Testing gaps (untested code paths, missing edge case tests)",
        "- Maintainability (code complexity, documentation, readability)",
        "",
        "Provide actionable, specific feedback with code examples when suggesting fixes.",
        "Rate severity: CRITICAL, HIGH, MEDIUM, LOW.",
        "Always explain WHY something is an issue, not just WHAT.",
      ].join("\n"),
      tools: ["*"],
      allowedTools: ["read", "write", "shell"],
    },
  },
  {
    name: "Security Reviewer",
    category: "security_review",
    description: "Security-focused code reviewer specializing in vulnerability detection and secure coding practices.",
    isDefault: true,
    createdBy: "system",
    kiroConfig: {
      name: "security-reviewer",
      description: "Security-focused code reviewer specializing in vulnerability detection, OWASP compliance, and secure coding",
      prompt: [
        "You are a security-focused code reviewer and application security specialist.",
        "Your primary goal is to identify security vulnerabilities and ensure secure coding practices.",
        "Focus on:",
        "- OWASP Top 10 vulnerabilities",
        "- SQL/NoSQL injection, XSS, CSRF, SSRF",
        "- Authentication and authorization flaws",
        "- Secrets and credential exposure",
        "- Input validation and sanitization",
        "- Cryptographic weaknesses",
        "- Insecure deserialization",
        "- Dependency vulnerabilities",
        "- Infrastructure security misconfigurations",
        "- Data exposure and privacy issues",
        "",
        "Rate every finding: CRITICAL, HIGH, MEDIUM, LOW with CVSS-like severity.",
        "Provide remediation steps with secure code examples.",
        "Reference CWE IDs when applicable.",
      ].join("\n"),
      tools: ["*"],
      allowedTools: ["read", "write", "shell"],
    },
  },
];

export async function seedDefaultAgents(): Promise<number> {
  const existing = await listAllAIAgents();
  const existingDefaults = existing.filter((a) => a.isDefault);
  if (existingDefaults.length >= DEFAULT_AGENTS.length) return 0;

  const existingNames = new Set(existing.map((a) => a.name));
  let seeded = 0;
  const now = new Date().toISOString();

  for (const template of DEFAULT_AGENTS) {
    if (existingNames.has(template.name)) continue;

    const id = crypto.randomUUID();
    const agent: AIAgentConfig = {
      ...template,
      aiAgentId: id,
      createdAt: now,
      updatedAt: now,
    };

    try {
      await createAIAgent(agent);
      seeded++;
    } catch {
      // Duplicate - skip
    }
  }

  return seeded;
}
