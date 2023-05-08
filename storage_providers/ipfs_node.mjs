import fs from 'fs';
import path from 'path';
import * as IPFS from 'kubo-rpc-client';

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export default function store(
  configJSON,
  logger,
  fileName,
  uploadedBy,
  cb,
  errorCount = 0,
) {
  const filePath = path.resolve('files', fileName);
  const ipfs = IPFS.create();
  logger.debug(`Try #${errorCount + 1}`);
  if (errorCount < 5) {
    try {
      const file = ipfs.add({ path: filePath });
      logger.debug(file.cid);
      ipfs.pin.add(file.cid);
      if (typeof cb === 'function') cb(file.cid);
    } catch (error) {
      // logger.error(error);
      sleep(5000).then(() => {
        store(configJSON, logger, fileName, uploadedBy, cb, errorCount + 1);
      });
    }
  } else {
    logger.error(`IPFS storage failed ${errorCount} times! We stopped trying.`);
    return false;
  }
}
