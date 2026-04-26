/**
 * Local Express server that wraps Lambda handlers for local development.
 * Connects to real AWS DynamoDB + SQS using your configured AWS credentials.
 *
 * Usage: npx tsx src/local-server.ts
 *
 * Environment variables (auto-loaded from .env):
 *   TABLE_NAME          - DynamoDB table name (e.g., dev-RemoteKiro)
 *   JOB_QUEUE_URL       - SQS queue URL
 *   ARTIFACTS_BUCKET    - S3 bucket for artifacts
 *   BUNDLES_BUCKET      - S3 bucket for bundles
 *   COGNITO_USER_POOL_ID - Cognito user pool ID
 *   AWS_REGION          - AWS region (default: ap-south-1)
 *   PORT                - Server port (default: 3000)
 */

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";

// ─── Import Lambda Handlers ───
import { handler as repositoryHandler } from "./handlers/repository.js";
import { handler as profileHandler } from "./handlers/profile.js";
import { handler as jobHandler } from "./handlers/job.js";
import { handler as jobWorkerHandler } from "./handlers/job-worker.js";
import { handler as agentHandler } from "./handlers/agent.js";
import { handler as webhookHandler } from "./handlers/webhook.js";

const PORT = parseInt(process.env.PORT ?? "3000", 10);

// ─── CORS Headers ───
const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PATCH, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type",
  "Access-Control-Max-Age": "3600",
};

// ─── Read request body ───
function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
    req.on("error", reject);
  });
}

// ─── Convert HTTP request → API Gateway event ───
function toApiGatewayEvent(
  method: string,
  url: URL,
  headers: Record<string, string>,
  body: string,
  pathParams: Record<string, string>,
): APIGatewayProxyEvent {
  const queryParams: Record<string, string> = {};
  url.searchParams.forEach((v, k) => { queryParams[k] = v; });

  return {
    httpMethod: method,
    path: url.pathname,
    pathParameters: Object.keys(pathParams).length > 0 ? pathParams : null,
    queryStringParameters: Object.keys(queryParams).length > 0 ? queryParams : null,
    headers,
    body: body || null,
    isBase64Encoded: false,
    resource: "",
    stageVariables: null,
    multiValueHeaders: {},
    multiValueQueryStringParameters: null,
    requestContext: {
      accountId: "local",
      apiId: "local",
      authorizer: {},
      protocol: "HTTP/1.1",
      httpMethod: method,
      identity: {} as any,
      path: url.pathname,
      stage: "local",
      requestId: crypto.randomUUID(),
      requestTimeEpoch: Date.now(),
      resourceId: "",
      resourcePath: "",
    },
  };
}

// ─── Route Matching ───
interface Route {
  method: string;
  pattern: RegExp;
  paramNames: string[];
  handler: (event: APIGatewayProxyEvent) => Promise<APIGatewayProxyResult>;
}

const routes: Route[] = [
  // Repository routes
  { method: "GET",   pattern: /^\/repositories$/,              paramNames: [],         handler: repositoryHandler },
  { method: "POST",  pattern: /^\/repositories$/,              paramNames: [],         handler: repositoryHandler },
  { method: "PATCH", pattern: /^\/repositories\/([^/]+)$/,     paramNames: ["repoId"], handler: repositoryHandler },

  // Profile routes
  { method: "GET",   pattern: /^\/profiles$/,                  paramNames: [],            handler: profileHandler },
  { method: "POST",  pattern: /^\/profiles$/,                  paramNames: [],            handler: profileHandler },
  { method: "POST",  pattern: /^\/profiles\/([^/]+)\/publish-bundle$/, paramNames: ["profileId"], handler: profileHandler },

  // Job routes (portal — JWT auth)
  { method: "GET",   pattern: /^\/jobs$/,                      paramNames: [],         handler: jobHandler },
  { method: "POST",  pattern: /^\/jobs$/,                      paramNames: [],         handler: jobHandler },
  { method: "GET",   pattern: /^\/jobs\/([^/]+)$/,             paramNames: ["jobId"],  handler: jobHandler },
  { method: "GET",   pattern: /^\/jobs\/([^/]+)\/events$/,     paramNames: ["jobId"],  handler: jobHandler },
  { method: "GET",   pattern: /^\/jobs\/([^/]+)\/artifacts$/,  paramNames: ["jobId"],  handler: jobHandler },
  { method: "POST",  pattern: /^\/jobs\/([^/]+)\/cancel$/,     paramNames: ["jobId"],  handler: jobHandler },

  // Job worker routes (agent — IAM auth, no JWT)
  { method: "POST",  pattern: /^\/jobs\/([^/]+)\/claim$/,      paramNames: ["jobId"],  handler: jobWorkerHandler },
  { method: "PATCH", pattern: /^\/jobs\/([^/]+)\/status$/,     paramNames: ["jobId"],  handler: jobWorkerHandler },
  { method: "POST",  pattern: /^\/jobs\/([^/]+)\/events$/,     paramNames: ["jobId"],  handler: jobWorkerHandler },
  { method: "POST",  pattern: /^\/jobs\/([^/]+)\/artifacts\/presign$/, paramNames: ["jobId"], handler: jobWorkerHandler },
  { method: "POST",  pattern: /^\/jobs\/([^/]+)\/complete$/,   paramNames: ["jobId"],  handler: jobWorkerHandler },
  { method: "POST",  pattern: /^\/jobs\/([^/]+)\/fail$/,       paramNames: ["jobId"],  handler: jobWorkerHandler },

  // Agent routes
  { method: "GET",   pattern: /^\/agents$/,                     paramNames: [],           handler: agentHandler },
  { method: "POST",  pattern: /^\/agents\/register$/,          paramNames: [],           handler: agentHandler },
  { method: "POST",  pattern: /^\/agents\/([^/]+)\/heartbeat$/, paramNames: ["agentId"], handler: agentHandler },

  // Webhook routes
  { method: "POST",  pattern: /^\/webhooks\/github$/,          paramNames: [],         handler: webhookHandler },
];

function matchRoute(method: string, pathname: string): { route: Route; params: Record<string, string> } | null {
  for (const route of routes) {
    if (route.method !== method) continue;
    const match = pathname.match(route.pattern);
    if (match) {
      const params: Record<string, string> = {};
      route.paramNames.forEach((name, i) => {
        params[name] = match[i + 1];
      });
      return { route, params };
    }
  }
  return null;
}

// ─── HTTP Server ───
const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
  const method = req.method?.toUpperCase() ?? "GET";
  const url = new URL(req.url ?? "/", `http://localhost:${PORT}`);

  // Handle CORS preflight
  if (method === "OPTIONS") {
    res.writeHead(204, CORS_HEADERS);
    res.end();
    return;
  }

  const matched = matchRoute(method, url.pathname);
  if (!matched) {
    res.writeHead(404, { ...CORS_HEADERS, "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: { code: "NOT_FOUND", message: `No route for ${method} ${url.pathname}` } }));
    return;
  }

  try {
    const body = await readBody(req);
    const headers: Record<string, string> = {};
    for (const [k, v] of Object.entries(req.headers)) {
      if (typeof v === "string") headers[k] = v;
      else if (Array.isArray(v)) headers[k] = v.join(", ");
    }
    // Normalize Authorization header casing
    if (headers["authorization"] && !headers["Authorization"]) {
      headers["Authorization"] = headers["authorization"];
    }

    const event = toApiGatewayEvent(method, url, headers, body, matched.params);
    const result = await matched.route.handler(event);

    const responseHeaders: Record<string, string> = {
      ...CORS_HEADERS,
      ...(result.headers as Record<string, string> ?? {}),
    };
    res.writeHead(result.statusCode, responseHeaders);
    res.end(result.body);
  } catch (err) {
    console.error("Unhandled error:", err);
    res.writeHead(500, { ...CORS_HEADERS, "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: { code: "INTERNAL_ERROR", message: (err as Error).message } }));
  }
});

server.listen(PORT, () => {
  console.log(`\n🚀 Local API server running at http://localhost:${PORT}`);
  console.log(`   TABLE_NAME:       ${process.env.TABLE_NAME}`);
  console.log(`   JOB_QUEUE_URL:    ${process.env.JOB_QUEUE_URL}`);
  console.log(`   ARTIFACTS_BUCKET: ${process.env.ARTIFACTS_BUCKET}`);
  console.log(`   AWS_REGION:       ${process.env.AWS_REGION ?? "default"}\n`);
});
