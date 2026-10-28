import { randomUUID } from 'crypto';
import fs from 'fs/promises';
import path from 'path';

const mediaRoot = path.resolve(process.cwd(), 'private_uploads/media');

export interface IdentifiedMedia {
  extension: string;
  mimeType: string;
  kind: 'image' | 'video' | 'audio' | 'document';
}

const supportedMedia: Record<string, IdentifiedMedia> = {
  'image/jpeg': { extension: '.jpg', mimeType: 'image/jpeg', kind: 'image' },
  'image/png': { extension: '.png', mimeType: 'image/png', kind: 'image' },
  'image/gif': { extension: '.gif', mimeType: 'image/gif', kind: 'image' },
  'video/mp4': { extension: '.mp4', mimeType: 'video/mp4', kind: 'video' },
  'audio/mpeg': { extension: '.mp3', mimeType: 'audio/mpeg', kind: 'audio' },
  'application/pdf': { extension: '.pdf', mimeType: 'application/pdf', kind: 'document' },
};

export function identifyMedia(buffer: Buffer): IdentifiedMedia | null {
  let mimeType: string | null = null;

  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    mimeType = 'image/jpeg';
  } else if (buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    mimeType = 'image/png';
  } else if (buffer.subarray(0, 6).toString('ascii') === 'GIF87a' || buffer.subarray(0, 6).toString('ascii') === 'GIF89a') {
    mimeType = 'image/gif';
  } else if (buffer.length >= 12 && buffer.subarray(4, 8).toString('ascii') === 'ftyp') {
    mimeType = 'video/mp4';
  } else if (
    buffer.subarray(0, 3).toString('ascii') === 'ID3' ||
    (buffer.length >= 2 && buffer[0] === 0xff && (buffer[1] & 0xe0) === 0xe0)
  ) {
    mimeType = 'audio/mpeg';
  } else if (buffer.subarray(0, 5).toString('ascii') === '%PDF-') {
    mimeType = 'application/pdf';
  }

  return mimeType ? supportedMedia[mimeType] : null;
}

function getAccountDirectory(accountId: string): string {
  if (!/^[0-9a-f-]{36}$/i.test(accountId)) {
    throw new Error('Invalid account identifier');
  }
  const directory = path.resolve(mediaRoot, accountId);
  if (!directory.startsWith(`${mediaRoot}${path.sep}`)) {
    throw new Error('Invalid media path');
  }
  return directory;
}

export async function saveAccountMedia(accountId: string, buffer: Buffer, media: IdentifiedMedia) {
  const accountDirectory = getAccountDirectory(accountId);
  await fs.mkdir(accountDirectory, { recursive: true, mode: 0o700 });
  const mediaId = `${randomUUID()}${media.extension}`;
  const filePath = path.resolve(accountDirectory, mediaId);

  if (!filePath.startsWith(`${accountDirectory}${path.sep}`)) {
    throw new Error('Invalid media path');
  }

  try {
    await fs.writeFile(filePath, buffer, { flag: 'wx', mode: 0o600 });
  } catch (error) {
    await fs.rm(filePath, { force: true });
    throw error;
  }
  return { mediaId, filePath };
}

export async function resolveAccountMedia(accountId: string, mediaId: string): Promise<string | null> {
  if (!/^[0-9a-f-]{36}\.(jpg|png|gif|mp4|mp3|pdf)$/i.test(mediaId)) {
    return null;
  }

  const accountDirectory = getAccountDirectory(accountId);
  const candidate = path.resolve(accountDirectory, mediaId);
  if (!candidate.startsWith(`${accountDirectory}${path.sep}`)) {
    return null;
  }

  try {
    const [realDirectory, realFile, stats] = await Promise.all([
      fs.realpath(accountDirectory),
      fs.realpath(candidate),
      fs.stat(candidate),
    ]);
    if (!realFile.startsWith(`${realDirectory}${path.sep}`) || !stats.isFile()) {
      return null;
    }
    return realFile;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return null;
    }
    throw error;
  }
}
