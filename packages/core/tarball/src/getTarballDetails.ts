import gunzipMaybe from 'gunzip-maybe';
import { Readable, Writable } from 'node:stream';
import * as tarStream from 'tar-stream';

export type TarballDetails = {
  fileCount: number;
  unpackedSize: number; // in bytes
};

const TARBALL_INSPECT_TIMEOUT_MS = 30_000;

export async function getTarballDetails(buffer: Buffer): Promise<TarballDetails> {
  let fileCount = 0;
  let unpackedSize = 0;
  const readable = Readable.from(buffer);
  const gunzip = gunzipMaybe();
  // the ExtractEvents typing hides the writable-stream surface
  const unpack = tarStream.extract() as tarStream.Extract & Writable;

  return new Promise((resolve, reject) => {
    const done = (err?: Error) => {
      clearTimeout(timer);
      readable.destroy();
      gunzip.destroy();
      unpack.destroy();
      if (err) {
        reject(err);
      } else {
        resolve({ fileCount, unpackedSize });
      }
    };
    // a corrupt gzip can stall mid-stream with neither finish nor error
    const timer = setTimeout(
      () => done(new Error('tarball inspection timed out')),
      TARBALL_INSPECT_TIMEOUT_MS
    );

    unpack.on('entry', (header, stream, next) => {
      fileCount++;
      unpackedSize += Number(header.size);
      stream.resume(); // important to ensure that "entry" events keep firing
      next();
    });
    unpack.on('finish', () => done());
    // errors on any stage — source, gunzip or extractor — must reject
    readable.on('error', done);
    gunzip.on('error', done);
    unpack.on('error', done);
    readable.pipe(gunzip).pipe(unpack);
  });
}
