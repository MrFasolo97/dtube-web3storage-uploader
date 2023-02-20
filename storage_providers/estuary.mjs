import EstuaryClient from 'estuary-client';

export default async function store(configJSON, logger, fileName, uploadedBy) {
  const defaultClient = EstuaryClient.ApiClient.instance;
  const filePath = `./files/${fileName}`;
  // Configure API key authorization: bearerAuth
  await defaultClient;
  const bearerAuth = defaultClient.authentications['bearerAuth'];
  bearerAuth.apiKey = configJSON.ESTUARY_BEARER;
  // Uncomment the following line to set a prefix for the API key, e.g. "Token" (defaults to null)
  bearerAuth.apiKeyPrefix = 'Bearer';
  let cid = '';
  const apiInstance = new EstuaryClient.ContentApi();
  const opts = {
    coluuid: 'dtube_videos',
    location: `${configJSON.upload_endpoint_root}download/${fileName}`,
    filename: fileName,
    replication: 5,
  };
  logger.info(`[ ${uploadedBy} ] ${filePath}`);
  await apiInstance.contentAddPost(filePath, opts, (error, estuaryData, response) => {
    if (error) {
      logger.error(error);
    } else {
      logger.info(`API called successfully. Returned data: ${estuaryData}`);
      cid = estuaryData.cid;
    }
  });
  return cid;
}
