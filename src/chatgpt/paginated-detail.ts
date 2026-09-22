import type { JsonValue } from "../core/types";
import type { ChatGptTransport } from "./client";
import { parseConversationDetail, type ChatGptConversationDetail } from "./envelopes";

const MAX_PAGES = 1_000;
const MAX_TOTAL_BYTES = 500_000_000;
const CURSOR = /^[A-Za-z0-9._~+/:=-]{1,4096}$/;
const ID = /^[A-Za-z0-9_-]{1,256}$/;
const IDENTITY_PATHS = ["id", "conversation_id", "conversation.id", "conversation.conversation_id"] as const;

export class PaginatedDetailError extends Error {
  readonly code = "PAGINATED_DETAIL_INVALID";
  constructor(message: string) {
    super(message);
    this.name = "PaginatedDetailError";
  }
}

interface Page {
  raw: JsonValue;
  messages: Record<string, JsonValue>[];
  hasPrevious: boolean;
  hasNext: boolean;
  startCursor: string | null;
}

interface IdentityField {
  path: typeof IDENTITY_PATHS[number];
  present: boolean;
  value: unknown;
}

export async function fetchPaginatedDetail(
  transport: ChatGptTransport,
  conversationId: string,
  workspaceId: string,
): Promise<{ raw: JsonValue; detail: ChatGptConversationDetail; correlationId: string; responseBytes: number }> {
  const first = await transport.request({ operation: "conversation_current", parameters: { conversationId } }, workspaceId, 120_000);
  const firstPage = parsePage(first.body, conversationId, "initial");
  if (firstPage.hasNext) throw new PaginatedDetailError("Newest conversation page unexpectedly has a newer page.");
  if (firstPage.messages.length === 0) throw new PaginatedDetailError("Newest conversation page contains no messages.");
  const pages: Page[] = [firstPage];
  let messages = firstPage.messages;
  const seenMessages = new Map(messages.map((message) => [message.id as string, JSON.stringify(message)]));
  const seenCursors = new Set<string>();
  let page = firstPage;
  let responseBytes = first.responseBytes;
  if (responseBytes > MAX_TOTAL_BYTES) throw new PaginatedDetailError("Conversation exceeded the total response byte limit.");
  while (page.hasPrevious) {
    const before = page.startCursor;
    if (!before || seenCursors.has(before)) throw new PaginatedDetailError("Conversation pagination returned a missing or repeated cursor.");
    if (pages.length >= MAX_PAGES) throw new PaginatedDetailError("Conversation pagination reached the page limit.");
    seenCursors.add(before);
    const response = await transport.request({ operation: "conversation_messages", parameters: { conversationId, before } }, workspaceId, 120_000);
    const older = parsePage(response.body, conversationId, "older");
    if (older.messages.length === 0) throw new PaginatedDetailError("Older conversation page contains no messages.");
    let overlap = 0;
    while (overlap < older.messages.length && overlap < messages.length
      && older.messages[older.messages.length - 1 - overlap]!.id === messages[overlap]!.id) {
      const item = older.messages[older.messages.length - 1 - overlap]!;
      if (seenMessages.get(item.id as string) !== JSON.stringify(item)) throw new PaginatedDetailError("A message changed across page boundaries.");
      overlap += 1;
    }
    const additions = older.messages.slice(0, older.messages.length - overlap);
    if (additions.length === 0 || additions.some((message) => seenMessages.has(message.id as string))) {
      throw new PaginatedDetailError("Conversation pagination made no ordered progress.");
    }
    for (const message of additions) seenMessages.set(message.id as string, JSON.stringify(message));
    messages = [...additions, ...messages];
    pages.push(older);
    responseBytes += response.responseBytes;
    if (responseBytes > MAX_TOTAL_BYTES) throw new PaginatedDetailError("Conversation exceeded the total response byte limit.");
    page = older;
  }
  if (messages.length === 0) throw new PaginatedDetailError("Conversation has no messages.");
  const firstObject = first.body as Record<string, JsonValue>;
  const mapping: Record<string, JsonValue> = {};
  const orderedIds = messages.map((message) => message.id as string);
  const rootId = "chatgpt-exporter-root";
  if (orderedIds.includes(rootId)) throw new PaginatedDetailError("Message identifier collides with the synthetic root.");
  mapping[rootId] = { id: rootId, message: null, parent: null, children: [orderedIds[0]!] };
  for (const [index, message] of messages.entries()) {
    const id = orderedIds[index]!;
    mapping[id] = {
      id,
      message,
      parent: index === 0 ? rootId : orderedIds[index - 1]!,
      children: index + 1 === messages.length ? [] : [orderedIds[index + 1]!],
    };
  }
  // Preserve every provider page in the raw archive. The mapping is a derived
  // linear selected branch, not a claim that the provider supplied sibling nodes.
  const { messages: _messages, page_info: _pageInfo, mapping: _mapping, ...metadata } = firstObject;
  const raw: JsonValue = {
    ...metadata,
    conversation_id: conversationId,
    title: metadata.title ?? null,
    create_time: metadata.create_time ?? null,
    update_time: metadata.update_time ?? null,
    current_node: orderedIds.at(-1)!,
    mapping,
    page_info: { has_previous_page: false, has_next_page: false, page_count: pages.length },
    source_pages: pages.map((item) => item.raw),
  } as JsonValue;
  const detail = parseConversationDetail(raw);
  return { raw, detail, correlationId: first.correlationId, responseBytes };
}

function parsePage(value: JsonValue, conversationId: string, pageKind: "initial" | "older"): Page {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new PaginatedDetailError("Conversation page must be an object.");
  const object = value as Record<string, JsonValue>;
  const identities = identityFields(object);
  if ((pageKind === "initial" && !identities.some((field) => field.present))
    || identities.some((field) => field.present && field.value !== conversationId)) {
    throw new PaginatedDetailError(`Conversation page identity does not match the requested conversation (${pageKind} page; ${identityDiagnostic(identities, conversationId)}).`);
  }
  if (!Array.isArray(object.messages)) throw new PaginatedDetailError("Conversation page has no messages array.");
  const messages: Record<string, JsonValue>[] = [];
  const ids = new Set<string>();
  for (const item of object.messages) {
    if (!item || typeof item !== "object" || Array.isArray(item)) throw new PaginatedDetailError("Conversation page has an invalid message.");
    const message = item as Record<string, JsonValue>;
    if (typeof message.id !== "string" || !ID.test(message.id) || ids.has(message.id)) throw new PaginatedDetailError("Conversation page has a missing, invalid, or duplicate message ID.");
    ids.add(message.id);
    messages.push(message);
  }
  const info = object.page_info;
  if (!info || typeof info !== "object" || Array.isArray(info)) throw new PaginatedDetailError("Conversation page has no page_info object.");
  const pageInfo = info as Record<string, JsonValue>;
  if (typeof pageInfo.has_previous_page !== "boolean" || typeof pageInfo.has_next_page !== "boolean") {
    throw new PaginatedDetailError("Conversation pagination flags are invalid.");
  }
  const start = pageInfo.start_cursor;
  if (start !== null && start !== undefined && (typeof start !== "string" || !CURSOR.test(start))) {
    throw new PaginatedDetailError("Conversation page has an invalid start cursor.");
  }
  const startCursor = typeof start === "string" ? start : null;
  if (pageInfo.has_previous_page && !startCursor) throw new PaginatedDetailError("Conversation has older messages but no valid start cursor.");
  return { raw: value, messages, hasPrevious: pageInfo.has_previous_page, hasNext: pageInfo.has_next_page, startCursor };
}

function identityFields(object: Record<string, JsonValue>): IdentityField[] {
  return IDENTITY_PATHS.map((path) => {
    const parts = path.split(".");
    let current: unknown = object;
    let present = true;
    for (const part of parts) {
      if (current === null || typeof current !== "object" || Array.isArray(current)
        || !Object.prototype.hasOwnProperty.call(current, part)) {
        present = false;
        break;
      }
      current = (current as Record<string, unknown>)[part];
    }
    return { path, present, value: present ? current : undefined };
  });
}

function identityDiagnostic(fields: IdentityField[], requestedId: string): string {
  return fields.map(({ path, present, value }) => {
    const type = !present ? "absent" : value === null ? "null" : Array.isArray(value) ? "array" : typeof value;
    return `${path}:present=${present},type=${type},matches=${present && typeof value === "string" && value === requestedId}`;
  }).join("; ");
}
