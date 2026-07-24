import { mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, extname, join, parse, resolve } from 'node:path';
import { AppError } from './errors.js';

const MAX_DOWNLOAD_BYTES = 15 * 1024 * 1024;
const MAX_FILENAME_ATTEMPTS = 1000;

export function createCsvDownload(input = {}) {
  const content = String(input.content || '');
  if (!content) {
    throw new AppError('EXPORT_CONTENT_REQUIRED', 'CSV export content is required', 422);
  }
  const body = Buffer.from(content, 'utf8');
  if (body.byteLength > MAX_DOWNLOAD_BYTES) {
    throw new AppError(
      'EXPORT_TOO_LARGE',
      `CSV export exceeds the ${MAX_DOWNLOAD_BYTES / 1024 / 1024} MB limit`,
      413
    );
  }

  const exportDirectory = resolve(
    process.env.EXPORT_DOWNLOAD_DIR || join(homedir(), 'Downloads')
  );
  const filename = safeCsvFilename(input.filename);

  try {
    mkdirSync(exportDirectory, { recursive: true });
    const saved = writeUniqueFile(exportDirectory, filename, body);
    return {
      filename: saved.filename,
      localPath: saved.localPath,
      sizeBytes: body.byteLength,
      createdAt: new Date().toISOString()
    };
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError(
      'EXPORT_WRITE_FAILED',
      `Unable to write the CSV export to ${exportDirectory}`,
      500,
      { directory: exportDirectory, cause: error.code || error.message }
    );
  }
}

function writeUniqueFile(exportDirectory, filename, body) {
  const extension = extname(filename);
  const basename = parse(filename).name;

  for (let index = 0; index < MAX_FILENAME_ATTEMPTS; index += 1) {
    const uniqueFilename = index === 0
      ? filename
      : `${basename} (${index})${extension}`;
    const localPath = resolve(exportDirectory, uniqueFilename);
    if (dirname(localPath) !== exportDirectory) {
      throw new AppError('EXPORT_FILENAME_INVALID', 'CSV export filename is invalid', 422);
    }
    try {
      writeFileSync(localPath, body, { flag: 'wx' });
      return { filename: uniqueFilename, localPath };
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
    }
  }

  throw new AppError(
    'EXPORT_FILENAME_EXHAUSTED',
    'Too many CSV exports have the same filename',
    409
  );
}

function safeCsvFilename(value) {
  const name = String(value || '报销单列表.csv')
    .replace(/[\u0000-\u001f\\/:*?"<>|]/g, '-')
    .trim();
  const safeName = name || '报销单列表.csv';
  return safeName.toLowerCase().endsWith('.csv') ? safeName : `${safeName}.csv`;
}
