import { uploadAttachment } from '../sdk/upload.js';
export async function runJob(
  job,
  {
    save,
    client,
    upload = uploadAttachment,
    onProgress = () => {},
    signal,
    authorize = async () => {},
  },
) {
  if (!['queued', 'uploading'].includes(job.state)) return job;
  let submitted = false;
  try {
    await authorize();
    signal?.throwIfAborted();
    job.state = 'uploading';
    job.updatedAt = Date.now();
    await save(job);
    job.uploaded ??= [];
    job.checkpoints ??= {};
    for (let i = 0; i < job.packet.attachments.length; i++) {
      await authorize();
      signal?.throwIfAborted();
      if (job.uploaded[i]) continue;
      const a = job.packet.attachments[i];
      const path = await upload(client, {
        botId: job.botId,
        sessionId: job.sessionId,
        blob: a.blob,
        name: a.name,
        signal,
        checkpoint: job.checkpoints[i],
        onCheckpoint: async (state) => {
          job.checkpoints[i] = state;
          await save(job);
        },
        onProgress: (done, total) => onProgress({ index: i, done, total }),
      });
      job.uploaded[i] = path;
      delete job.checkpoints[i];
      await save(job);
    }
    signal?.throwIfAborted();
    job.state = 'submitting';
    job.updatedAt = Date.now();
    await save(job);
    await authorize();
    signal?.throwIfAborted();
    submitted = true;
    const result = await client.sendMessage({
      botId: job.botId,
      sessionId: job.sessionId,
      text: job.packet.text,
      messageId: job.messageId,
      attachmentPaths: job.uploaded,
      attachmentNames: job.packet.attachments.map((a) => a.name),
      signal,
    });
    job.state = 'accepted';
    job.delivery = result.delivery;
    job.error = '';
    job.acceptedAt = Date.now();
  } catch (error) {
    job.error = error.code ?? error.message ?? 'SEND_FAILED';
    if (error.limitBytes) job.limitBytes = error.limitBytes;
    job.state =
      submitted && (job.error === 'SEND_UNCONFIRMED' || !error.code) ? 'uncertain' : 'failed';
  }
  job.updatedAt = Date.now();
  await save(job);
  return job;
}

export function deliveryState(status) {
  if (status === 2 || status === 'GROK_BOT_SEND_STATUS_ACCEPTED') return 'accepted';
  if (status === 3 || status === 'GROK_BOT_SEND_STATUS_REJECTED') return 'failed';
  return 'uncertain';
}
