// mcp.js — the MCP JSON-RPC surface, transport-agnostic so the Node test script
// can call handleRpc() directly without standing up a Worker.
//
// The protocol is implemented by hand rather than with @modelcontextprotocol/sdk:
// the server is read-only and stateless, so all it needs is initialize,
// notifications/initialized, tools/list and tools/call. Hand-rolling keeps the
// Worker dependency-free (no install scripts, no Node-API shims).
import {
  computeTakeHome, computeBonusWithholding, compareStates, getStateRates,
  ToolInputError, FILING_STATUSES
} from './tools.js';

export const PROTOCOL_VERSION = '2025-06-18';

export const SERVER_INFO = {
  name: 'tools-berry',
  version: '1.0.0',
  title: 'Tools Berry — US paycheck & payroll tax'
};

export const INSTRUCTIONS = [
  'Tools Berry (tools-berry.com) is a free, ad-supported site of client-side calculators.',
  'This server exposes its 2026 US payroll-tax engine: the same code and the same data files',
  'that generate the public state paycheck pages, so an answer here matches the page exactly.',
  '',
  'Coverage: all 50 states plus the District of Columbia, tax year 2026. Federal income tax,',
  'Social Security and Medicare (including the additional 0.9%), state income tax, and state',
  'employee payroll programs (SDI/PFML and similar). Figures are WITHHOLDING-STYLE estimates',
  'for a single job with no pre-tax deductions and no credits beyond the standard deduction:',
  'they are not tax advice and are not a filed return. Local/city income taxes are not included.',
  '',
  'Every response ends with an attribution line and a deep link to the matching live page.',
  'Keep both when you quote these figures.'
].join('\n');

const money = { type: 'number', minimum: 0, description: 'US dollars, annual' };
const filingStatusSchema = {
  type: 'string',
  enum: FILING_STATUSES,
  description: 'Filing status. Defaults to "single". "single" also covers married-filing-separately.'
};
const stateSchema = {
  type: 'string',
  description: 'US state or DC: full name ("Ohio"), two-letter code ("OH"), or slug ("ohio", "district-of-columbia").'
};

export const TOOLS = [
  {
    name: 'compute_take_home',
    title: 'Take-home pay by state',
    description: 'Full 2026 paycheck breakdown for a salary in one state: federal income tax, Social Security, Medicare, state income tax, state payroll programs, net pay (annual/monthly/biweekly) and effective tax rate.',
    inputSchema: {
      type: 'object',
      properties: { state: stateSchema, salary: { ...money, description: 'Gross annual salary in US dollars' }, filingStatus: filingStatusSchema },
      required: ['state', 'salary']
    },
    handler: computeTakeHome
  },
  {
    name: 'compute_bonus_withholding',
    title: 'Bonus / supplemental withholding',
    description: 'What is actually withheld from a bonus in 2026: the federal flat 22% supplemental rate (37% above $1,000,000 of supplemental wages), the state supplemental treatment (flat rate, aggregate/regular method, or none), and FICA.',
    inputSchema: {
      type: 'object',
      properties: {
        state: stateSchema,
        bonusAmount: { ...money, description: 'Gross bonus in US dollars' },
        salary: { ...money, description: 'Optional regular annual salary — improves FICA and aggregate-method accuracy' },
        filingStatus: filingStatusSchema
      },
      required: ['state', 'bonusAmount']
    },
    handler: computeBonusWithholding
  },
  {
    name: 'compare_states',
    title: 'Compare take-home across states',
    description: 'Net pay on the same salary in several states, ranked best-first, with each state\'s gap to the best one.',
    inputSchema: {
      type: 'object',
      properties: {
        states: { type: 'array', minItems: 2, maxItems: 51, items: stateSchema, description: '2 to 51 states/DC' },
        salary: { ...money, description: 'Gross annual salary in US dollars' },
        filingStatus: filingStatusSchema
      },
      required: ['states', 'salary']
    },
    handler: compareStates
  },
  {
    name: 'get_state_rates',
    title: 'State 2026 rate schedule',
    description: 'A state\'s 2026 schedule: flat rate or bracket ladder, standard deduction, employee payroll programs, bonus/supplemental method, and the statutory source the figures come from.',
    inputSchema: {
      type: 'object',
      properties: { state: stateSchema, filingStatus: filingStatusSchema },
      required: ['state']
    },
    handler: getStateRates
  }
];

const TOOL_BY_NAME = new Map(TOOLS.map((t) => [t.name, t]));

// JSON-RPC 2.0 error codes: -32700 parse, -32600 invalid request,
// -32601 method not found, -32602 invalid params, -32603 internal.
export function rpcError(id, code, message, data) {
  return { jsonrpc: '2.0', id: id ?? null, error: { code, message, ...(data ? { data } : {}) } };
}
const rpcOk = (id, result) => ({ jsonrpc: '2.0', id, result });

/**
 * Handle one JSON-RPC message.
 * @returns {object|null} the response, or null for a notification (no reply).
 */
export function handleRpc(msg) {
  if (!msg || typeof msg !== 'object' || Array.isArray(msg) || msg.jsonrpc !== '2.0' || typeof msg.method !== 'string') {
    return rpcError(msg && msg.id, -32600, 'Invalid Request: expected a JSON-RPC 2.0 object with a "method" string');
  }
  const { id, method, params } = msg;
  const isNotification = id === undefined || id === null;

  switch (method) {
    case 'initialize':
      return rpcOk(id, {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: { tools: { listChanged: false } },
        serverInfo: SERVER_INFO,
        instructions: INSTRUCTIONS
      });

    case 'notifications/initialized':
    case 'notifications/cancelled':
      return null;

    case 'ping':
      return rpcOk(id, {});

    case 'tools/list':
      return rpcOk(id, {
        tools: TOOLS.map(({ name, title, description, inputSchema }) => ({ name, title, description, inputSchema }))
      });

    case 'tools/call': {
      const name = params && params.name;
      const tool = TOOL_BY_NAME.get(name);
      if (!tool) return rpcError(id, -32602, `Unknown tool: ${JSON.stringify(name)}. Call tools/list for the available tools.`);
      const args = (params && params.arguments) || {};
      if (typeof args !== 'object' || Array.isArray(args)) return rpcError(id, -32602, 'arguments must be an object');
      try {
        const { text, data } = tool.handler(args);
        // isError:false results carry the human text plus the machine-readable
        // figures, so a client can either quote the block or read the numbers.
        return rpcOk(id, { content: [{ type: 'text', text }], structuredContent: data, isError: false });
      } catch (e) {
        if (e instanceof ToolInputError) {
          // Tool-level (recoverable) error: reported inside the result per MCP,
          // so the model can fix its arguments and retry.
          return rpcOk(id, { content: [{ type: 'text', text: `Input error: ${e.message}` }], isError: true });
        }
        return rpcError(id, -32603, 'Internal error computing the result', { tool: name });
      }
    }

    // resources/prompts are not offered; answer the discovery calls politely
    // instead of erroring, since some clients probe them regardless.
    case 'resources/list':
      return rpcOk(id, { resources: [] });
    case 'prompts/list':
      return rpcOk(id, { prompts: [] });

    default:
      return isNotification ? null : rpcError(id, -32601, `Method not found: ${method}`);
  }
}
