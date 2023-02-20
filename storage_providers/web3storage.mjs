import { Web3Storage, getFilesFromPath } from 'web3.storage';
import fs from 'fs';

export default async function store(configJSON, logger, fileName, uploadedBy) {
  const filePath = `files/${fileName}`;
  const { web3token } = configJSON;
  if (!web3token) {
    return logger.error('A token is needed. You can create one on https://web3.storage');
  }
  logger.info(`[ ${uploadedBy} ] ${filePath}`);
  const storage = new Web3Storage({ token: web3token });
  const file = await getFilesFromPath(filePath);
  const cid = await storage.put(file, { wrapWithDirectory: false });
  logger.info(`[ ${uploadedBy} ] Content added with CID: ${cid}`);
  if (fs.existsSync(filePath)) {
    fs.unlink(filePath, (err) => {
      if (err) {
        logger.error(err.message);
      }
      // if no error, file has been deleted successfully
      logger.info(`File ${filePath} deleted!`);
    });
  }
  return cid;
}
