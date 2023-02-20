import mcsSDK from 'js-mcs-sdk';
import * as fs from 'fs';

// NOT WORKING I GUESS.
export default async function store(configJSON, logger, fileName, uploadedBy) {
  const filePath = `files/${fileName}`;
  logger.info(`[ ${uploadedBy} ] ${filePath}`);
  const mcs = await mcsSDK.initialize({
    accessToken: process.env.ACCESS_TOKEN,
    apiKey: process.env.API_KEY,
    privateKey: process.env.PRIVATE_KEY,
  });

  const fileContent = fs.readFileSync(filePath);
  const fileArray = [{ fileName: `${mcs.walletAddress}.txt`, file: fileContent }];

  const uploadResponse = await mcs.upload(fileArray);
  logger.info(uploadResponse);
  if (fs.existsSync(filePath)) {
    fs.unlink(filePath, (err) => {
      if (err) {
        logger.error(err.message);
      }
      // if no error, file has been deleted successfully
      logger.info(`File ${filePath} deleted!`);
    });
  }
  // return cid;
}
