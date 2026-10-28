const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

test('media upload validation uses content signatures and isolates files by account', async () => {
  const originalCwd = process.cwd();
  const temporaryDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'whafeisty-media-test-'));
  process.chdir(temporaryDirectory);

  try {
    const { identifyMedia, resolveAccountMedia, saveAccountMedia } = require('../dist/services/media/storage');
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);
    const mediaType = identifyMedia(png);
    assert.equal(mediaType.mimeType, 'image/png');
    assert.equal(identifyMedia(Buffer.from('not a real image')), null);

    const accountId = randomUUID();
    const otherAccountId = randomUUID();
    const saved = await saveAccountMedia(accountId, png, mediaType);
    assert.equal(await resolveAccountMedia(accountId, saved.mediaId), saved.filePath);
    assert.equal(await resolveAccountMedia(otherAccountId, saved.mediaId), null);
    assert.equal(await resolveAccountMedia(accountId, '../outside.png'), null);
  } finally {
    process.chdir(originalCwd);
    await fs.rm(temporaryDirectory, { recursive: true, force: true });
  }
});
