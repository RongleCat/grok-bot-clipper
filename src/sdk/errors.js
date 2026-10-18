const CODES = new Set([
  'SDK_ERROR',
  'MISSING_ACCESS_TOKEN',
  'RPC_FAILED',
  'ACCOUNT_AUTH_FAILED',
  'INVALID_ROSTER_RESPONSE',
  'INVALID_BOT_RECORD',
  'BOT_ID_REQUIRED',
  'MESSAGE_INVALID',
  'SEND_UNCONFIRMED',
  'SEND_REFUSED',
  'CURSOR_INVALID',
  'CURSOR_SCOPE_MISMATCH',
  'STREAM_CONNECTION_FAILED',
  'STREAM_RPC_ERROR',
  'STREAM_FRAME_TOO_LARGE',
  'STREAM_UNEXPECTED_EOF',
  'STREAM_COMPRESSION_UNSUPPORTED',
  'STREAM_FLAGS_INVALID',
  'STREAM_INVALID_JSON',
  'STREAM_END_INVALID',
  'STREAM_INVALID_RESPONSE',
  'STREAM_PROTOCOL_ERROR',
  'STREAM_CANCELLED',
]);
export class SDKError extends Error {
  constructor(code, httpStatus) {
    super(
      CODES.has(code) || /^(UPLOAD_|ATTACHMENT_|STATUS_)[A-Z0-9_]{1,90}$/.test(code)
        ? code
        : 'SDK_ERROR',
    );
    this.name = 'SDKError';
    this.code = this.message;
    if (Number.isInteger(httpStatus)) this.httpStatus = httpStatus;
  }
}
