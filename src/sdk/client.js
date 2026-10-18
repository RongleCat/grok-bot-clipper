const randomUUID = () => crypto.randomUUID();
import { encodeJSON, decodeJSON, fromBase64 } from './bytes.js';
import { API_ORIGIN, clientHeaders, requestJSON } from './core.js';
import { resolveAgentAvatar } from './avatar.js';
import { SDKError } from './errors.js';
import { encodeConnectFrame, readConnectFrames } from './connect.js';
import { eventsToSSE } from './sse.js';

export { createLogin, pollLogin } from './core.js';
export { deriveDefaultAvatar, resolveAgentAvatar } from './avatar.js';
export { SDKError } from './errors.js';

function botKey(value) {
  if (
    typeof value !== 'string' ||
    !value.length ||
    value.length > 128 ||
    !/^[A-Za-z0-9_-]+$/.test(value)
  )
    throw new SDKError('BOT_ID_REQUIRED');
  return value;
}
function uint64(value) {
  if (typeof value === 'number' && !Number.isSafeInteger(value))
    throw new SDKError('CURSOR_INVALID');
  const text = String(value ?? 0);
  if (!/^\d{1,20}$/.test(text) || BigInt(text) > 18446744073709551615n)
    throw new SDKError('CURSOR_INVALID');
  return String(BigInt(text));
}
function generation(value) {
  const number = value ?? 0;
  if (!Number.isInteger(number) || number < 0 || number > 4294967295)
    throw new SDKError('CURSOR_INVALID');
  return number;
}
function cursorID(botId, sessionId, state) {
  return encodeJSON({
    botId,
    sessionId,
    generation: state.generation,
    afterUpdatedSeq: state.afterUpdatedSeq,
  });
}
function resumeCursor(value, botId, sessionId) {
  let parsed;
  try {
    if (typeof value !== 'string' || value.length > 2048 || !/^[A-Za-z0-9_-]+$/.test(value))
      throw new Error();
    parsed = decodeJSON(value);
  } catch {
    throw new SDKError('CURSOR_INVALID');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
    throw new SDKError('CURSOR_INVALID');
  if (parsed.botId !== botId || parsed.sessionId !== sessionId)
    throw new SDKError('CURSOR_SCOPE_MISMATCH');
  return {
    generation: generation(parsed.generation),
    afterUpdatedSeq: uint64(parsed.afterUpdatedSeq),
  };
}
function decodeEntry(entry) {
  if (typeof entry.body !== 'string' || !entry.body) return null;
  try {
    const body = JSON.parse(
      new TextDecoder('utf-8', { fatal: true }).decode(fromBase64(entry.body)),
    );
    return body && typeof body === 'object' && !Array.isArray(body) ? body : null;
  } catch {
    return null;
  }
}

export function normalizeBot(agent) {
  if (!agent || typeof agent.agentId !== 'string' || !agent.agentId)
    throw new SDKError('INVALID_BOT_RECORD');
  const avatar = resolveAgentAvatar(agent);
  const text = (value) => (typeof value === 'string' ? value : '');
  return {
    id: agent.agentId,
    serverId: typeof agent.id === 'string' ? agent.id : null,
    name: text(agent.name),
    description: text(agent.description),
    title: text(agent.title),
    avatarShape: avatar.character.shape,
    avatarColor: avatar.character.color,
    avatar,
    harness: text(agent.harness),
    kind: text(agent.kind),
    sessionId: text(agent.viewerSessionId),
    teamId: Number.isInteger(agent.teamId) ? agent.teamId : null,
    viewerIsOwner: agent.viewerIsOwner === true,
    viewerCanManage: agent.viewerCanManage === true,
  };
}

export class GrokBotClient {
  #options;
  constructor(options) {
    if (typeof options?.accessToken !== 'string' || !options.accessToken)
      throw new SDKError('MISSING_ACCESS_TOKEN');
    this.#options = { ...options, version: options.version ?? '0.70.2' };
  }
  async rpc(service, method, body, signal) {
    return requestJSON(`${API_ORIGIN}/aiserver.v1.${service}/${method}`, {
      headers: clientHeaders(this.#options),
      body,
      fetchImpl: this.#options.fetchImpl,
      signal,
    });
  }
  fetch(url, options) {
    return (this.#options.fetchImpl ?? fetch)(url, options);
  }
  async getSendStatus({ botId, messageId, sessionId = '' }) {
    const r = await this.rpc('GrokBotService', 'GetGrokBotSendStatus', {
      agentId: botId,
      messageId,
      sessionId,
    });
    if (!r.ok) throw new SDKError('STATUS_UNAVAILABLE', r.httpStatus);
    return r.data;
  }
  async getMe() {
    const response = await this.rpc('DashboardService', 'GetMe', {});
    if (!response.ok || !(response.data?.authId || response.data?.userId))
      throw new SDKError('ACCOUNT_AUTH_FAILED', response.httpStatus);
    return response.data;
  }
  async listTeams() {
    const r = await this.rpc('DashboardService', 'GetTeams', { activeOnly: true });
    if (!r.ok || !Array.isArray(r.data?.teams)) throw new SDKError('RPC_FAILED', r.httpStatus);
    return r.data.teams
      .filter((t) => Number.isSafeInteger(t.id) && typeof t.name === 'string')
      .map((t) => ({ id: t.id, name: t.name }));
  }
  async listTranscript({ botId, sessionId = '', limit = 50 } = {}) {
    botKey(botId);
    const r = await this.rpc('GrokBotService', 'ListGrokBotTranscriptEntries', {
      agentId: botId,
      sessionId,
      limit: Math.min(100, Math.max(1, limit)),
    });
    if (!r.ok || !Array.isArray(r.data?.entries)) throw new SDKError('RPC_FAILED', r.httpStatus);
    const messages = [];
    let afterUpdatedSeq = '0';
    for (const row of r.data.entries) {
      const seq = uint64(row.updatedSeq ?? row.seq);
      if (BigInt(seq) > BigInt(afterUpdatedSeq)) afterUpdatedSeq = seq;
      const body = decodeEntry(row);
      if (
        body?.kind === 'send-message' &&
        body.message?.type === 'text' &&
        typeof body.message.content === 'string'
      )
        messages.push({
          entryId: row.entryId ?? body.id,
          text: body.message.content,
          seq: uint64(row.seq),
          updatedSeq: seq,
        });
    }
    return { messages, cursor: { generation: generation(r.data.generation), afterUpdatedSeq } };
  }
  async listBots({ includeTeamAgents = true } = {}) {
    const response = await this.rpc('GrokBotService', 'ListGrokBotAgents', { includeTeamAgents });
    if (!response.ok) throw new SDKError('RPC_FAILED', response.httpStatus);
    if (!Array.isArray(response.data?.agents)) throw new SDKError('INVALID_ROSTER_RESPONSE');
    return {
      bots: response.data.agents.map(normalizeBot),
      truncated: response.data.truncated === true,
    };
  }

  async sendMessage({
    botId,
    text,
    sessionId = '',
    messageId = randomUUID(),
    attachmentPaths = [],
    attachmentNames = [],
    signal,
  } = {}) {
    botKey(botId);
    if (
      typeof text !== 'string' ||
      !text.trim() ||
      typeof sessionId !== 'string' ||
      typeof messageId !== 'string' ||
      !messageId ||
      !Array.isArray(attachmentPaths) ||
      !Array.isArray(attachmentNames) ||
      attachmentPaths.length !== attachmentNames.length ||
      [...attachmentPaths, ...attachmentNames].some((value) => typeof value !== 'string' || !value)
    )
      throw new SDKError('MESSAGE_INVALID');
    const response = await this.rpc(
      'GrokBotService',
      'SendGrokBotUserMessage',
      {
        agentId: botId,
        text,
        sessionId,
        messageId,
        attachmentPaths,
        attachmentNames,
        sentAtMs: String(Date.now()),
        isFork: false,
        source: 1,
        initiator: 1,
        sendSource: 1,
      },
      signal,
    );
    if (!response.ok) throw new SDKError('SEND_UNCONFIRMED', response.httpStatus);
    const deliveries = {
      1: 'accepted-box',
      2: 'accepted-temporal',
      3: 'duplicate',
      GROK_BOT_USER_MESSAGE_DELIVERY_ACCEPTED_BOX: 'accepted-box',
      GROK_BOT_USER_MESSAGE_DELIVERY_ACCEPTED_TEMPORAL: 'accepted-temporal',
      GROK_BOT_USER_MESSAGE_DELIVERY_DUPLICATE: 'duplicate',
    };
    const delivery = deliveries[response.data?.delivery];
    if (!delivery) throw new SDKError('SEND_REFUSED');
    return { botId, messageId, delivery, dispatched: response.data.dispatched === true };
  }

  async *watchBot({
    botId,
    sessionId = '',
    cursor,
    resumeFrom,
    signal,
    inlineBodyMaxBytes = 262144,
  } = {}) {
    botKey(botId);
    if (typeof sessionId !== 'string' || sessionId.length > 256 || (cursor && resumeFrom))
      throw new SDKError('CURSOR_INVALID');
    if (
      !Number.isInteger(inlineBodyMaxBytes) ||
      inlineBodyMaxBytes < 1 ||
      inlineBodyMaxBytes > 524288
    )
      throw new SDKError('STREAM_FRAME_TOO_LARGE');
    if (signal?.aborted) return;
    let state;
    if (resumeFrom) state = resumeCursor(resumeFrom, botId, sessionId);
    else if (cursor)
      state = {
        generation: generation(cursor.generation),
        afterUpdatedSeq: uint64(cursor.afterUpdatedSeq),
      };
    else {
      const tail = await this.rpc(
        'GrokBotService',
        'ListGrokBotTranscriptEntries',
        { agentId: botId, sessionId, limit: 1 },
        signal,
      );
      if (signal?.aborted) return;
      if (!tail.ok || !Array.isArray(tail.data?.entries))
        throw new SDKError('RPC_FAILED', tail.httpStatus);
      state = {
        generation: generation(tail.data.generation),
        afterUpdatedSeq: tail.data.entries.reduce(
          (max, row) =>
            BigInt(uint64(row.updatedSeq ?? row.seq)) > BigInt(max)
              ? uint64(row.updatedSeq ?? row.seq)
              : max,
          '0',
        ),
      };
    }
    if (signal?.aborted) return;
    const control = new AbortController();
    const upstreamSignal = signal ? AbortSignal.any([signal, control.signal]) : control.signal;
    let headersTimeout = setTimeout(() => control.abort(), 20000);
    headersTimeout.unref?.();
    try {
      const response = await (this.#options.fetchImpl ?? fetch)(
        `${API_ORIGIN}/aiserver.v1.GrokBotService/WatchGrokBotTranscripts`,
        {
          method: 'POST',
          headers: {
            ...clientHeaders(this.#options),
            'content-type': 'application/connect+json',
            accept: 'application/connect+json',
            'connect-accept-encoding': 'identity',
          },
          body: encodeConnectFrame({
            cursors: [{ agentId: botId, sessionId, ...state }],
            includeUnlistedAgents: false,
            inlineBodyMaxBytes,
          }),
          redirect: 'error',
          signal: upstreamSignal,
        },
      );
      clearTimeout(headersTimeout);
      if (!response.ok) throw new SDKError('STREAM_CONNECTION_FAILED', response.status);
      if (response.headers.get('content-type')?.split(';')[0].trim() !== 'application/connect+json')
        throw new SDKError('STREAM_INVALID_RESPONSE');
      for await (const frame of readConnectFrames(response.body, {
        onClose: () => control.abort(),
      })) {
        if (signal?.aborted) return;
        if (frame.connected)
          yield {
            type: 'connected',
            data: {
              serverTimeMs: String(frame.connected.serverTimeMs ?? 0),
              absoluteLifetimeMs: String(frame.connected.absoluteLifetimeMs ?? 0),
            },
          };
        if (frame.heartbeat)
          yield {
            type: 'heartbeat',
            data: { serverTimeMs: String(frame.heartbeat.serverTimeMs ?? 0) },
          };
        const rows = frame.rows;
        if (rows?.agentId === botId && (rows.sessionId ?? '') === sessionId) {
          const nextGeneration = generation(rows.generation);
          if (nextGeneration !== state.generation) {
            state = { generation: nextGeneration, afterUpdatedSeq: '0' };
            yield {
              type: 'reset',
              id: cursorID(botId, sessionId, state),
              data: { botId, generation: nextGeneration },
            };
          }
          const operations = [
            ...(rows.entries ?? []).map((entry) => ({
              entry,
              deleted: false,
              updated: uint64(entry.updatedSeq ?? entry.seq),
            })),
            ...(rows.deletes ?? []).map((entry) => ({
              entry,
              deleted: true,
              updated: uint64(entry.updatedSeq ?? entry.seq),
            })),
          ].sort((a, b) =>
            BigInt(a.updated) < BigInt(b.updated)
              ? -1
              : BigInt(a.updated) > BigInt(b.updated)
                ? 1
                : 0,
          );
          for (const { entry, deleted, updated } of operations) {
            if (BigInt(updated) <= BigInt(state.afterUpdatedSeq)) continue;
            state.afterUpdatedSeq = updated;
            const base = {
              botId,
              sessionId,
              generation: state.generation,
              seq: uint64(entry.seq),
              updatedSeq: updated,
              entryId: entry.entryId ?? null,
              replay: rows.replay === true,
            };
            const id = cursorID(botId, sessionId, state);
            if (deleted) {
              yield { type: 'message.deleted', id, data: base };
              continue;
            }
            const body = decodeEntry(entry);
            if (!body) {
              yield {
                type: 'entry.unavailable',
                id,
                data: {
                  ...base,
                  entryKind: entry.entryKind ?? '',
                  bodyOmitted: entry.bodyOmitted === true,
                  blobHash: entry.blobHash ?? null,
                },
              };
              continue;
            }
            if (
              body.kind === 'send-message' &&
              body.message?.type === 'text' &&
              typeof body.message.content === 'string'
            )
              yield {
                type: 'message',
                id,
                data: {
                  ...base,
                  entryId: entry.entryId ?? body.id ?? null,
                  operation: 'upsert',
                  text: body.message.content,
                },
              };
            else
              yield {
                type: 'entry',
                id,
                data: { ...base, entryKind: body.kind ?? entry.entryKind ?? '', entry: body },
              };
          }
        }
        if (frame.cleared?.agentId === botId && (frame.cleared.sessionId ?? '') === sessionId) {
          state = { generation: generation(frame.cleared.newGeneration), afterUpdatedSeq: '0' };
          yield {
            type: 'reset',
            id: cursorID(botId, sessionId, state),
            data: { botId, generation: state.generation },
          };
        }
        if (
          frame.cursorTooOld?.agentId === botId &&
          (frame.cursorTooOld.sessionId ?? '') === sessionId
        ) {
          yield {
            type: 'resync-required',
            data: { botId, generation: generation(frame.cursorTooOld.generation) },
          };
          return;
        }
        if (frame.turnFailed?.agentId === botId && (frame.turnFailed.sessionId ?? '') === sessionId)
          yield {
            type: 'turn.failed',
            data: {
              botId,
              turnId: frame.turnFailed.turnId ?? '',
              code: frame.turnFailed.code ?? 0,
              summary: frame.turnFailed.summary ?? '',
            },
          };
        if (frame.agentStateChanged?.agentId === botId)
          yield {
            type: 'bot.state.changed',
            data: { botId, families: frame.agentStateChanged.families ?? [] },
          };
        if (frame.rosterChanged?.agentId === botId) {
          const changed = frame.rosterChanged;
          if (!changed.agent || changed.agent.agentId === botId)
            yield {
              type: 'bot.updated',
              data: {
                botId,
                changedFields: changed.changedFields ?? [],
                bot: changed.agent ? normalizeBot(changed.agent) : null,
              },
            };
        }
      }
    } catch (error) {
      if (signal?.aborted) return;
      if (error instanceof SDKError) throw error;
      throw new SDKError('STREAM_CONNECTION_FAILED');
    } finally {
      clearTimeout(headersTimeout);
      control.abort();
    }
  }

  botEventsSSE(options = {}) {
    const control = new AbortController();
    const signal = options.signal
      ? AbortSignal.any([options.signal, control.signal])
      : control.signal;
    return eventsToSSE(this.watchBot({ ...options, signal }), {
      signal,
      keepAliveMs: options.keepAliveMs ?? 15000,
      onCancel: () => control.abort(),
    });
  }
}
