import FormData from 'form-data';
import fs from 'fs';
import axios from 'axios';
import path from 'path';

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export default async function store(
  configJSON,
  logger,
  fileName,
  uploadedBy,
  cb,
  errorCount = 0,
) {
  const data = new FormData();
  const filePath = path.resolve('files', fileName);
  data.append('data', fs.createReadStream(filePath));
  const config = {
    method: 'post',
    url: `https://api.estuary.tech/content/add?coluuid=${configJSON.ESTUARY_COLLECTION_UUID}`,
    headers: {
      'Accept': 'application/json',
      'Authorization': configJSON.ESTUARY_BEARER,
      ...data.getHeaders(),
    },
    data: data,
  };
  logger.debug(`Try #${errorCount + 1}`);
  if (errorCount < 5) {
    await axios(config).then((response) => {
      logger.debug(response.data.cid);
      if (typeof cb === 'function') cb(response.data.cid);
    }).catch((error) => {
      // logger.error(error);
      sleep(5000).then(() => {
        store(configJSON, logger, fileName, uploadedBy, cb, errorCount + 1);
      });
    });
  } else {
    logger.error(`Estuary storage failed ${errorCount} times! We stopped trying.`);
    return false;
  }
}
