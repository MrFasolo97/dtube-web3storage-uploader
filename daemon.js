import process, { exit } from 'process';
import { Command } from 'commander';
import { Web3Storage, getFilesFromPath } from 'web3.storage';
import express from 'express';
import * as fs from 'fs';
import version from 'project-version';
import log4js from 'log4js';
import tus from 'tus-node-server';

const { EVENTS } = tus;

const server = new tus.Server();
server.datastore = new tus.FileStore({
  path: '/files',
});

log4js.configure({
  appenders: {
    logs: { type: 'file', filename: 'logs/logs.log' },
    console: { type: 'console' },
  },
  categories: {
    logs: { appenders: ['logs'], level: 'trace' },
    console: { appenders: ['console'], level: 'trace' },
    default: { appenders: ['console', 'logs'], level: 'trace' },
  },
});

const program = new Command();
program
  .option('-t, --token <token>', 'API Token')
  .option('-d, --daemon', 'Run as daemon', false)
  .option('-c, --config <file>', 'Config file', './config.json');

const logger = log4js.getLogger();

program.parse(process.argv);
const opts = program.opts();
let configJSON = {};

if (fs.existsSync(opts.config)) {
  configJSON = JSON.parse(fs.readFileSync(opts.config));
} else {
  logger.fatal('Config file not found!');
  exit();
}

const web3token = opts.token || configJSON.web3token;
const port = configJSON.port || 5000;

const app = express();
const filesUploaded = {};

const uploadApp = express();

async function uploadFile(web3token2, fileName, uploadedBy) {
  const filePath = `files/${fileName}`;
  if (!web3token2) {
    return logger.error('A token is needed. You can create one on https://web3.storage');
  }
  logger.info(`[ ${uploadedBy} ] ${filePath}`);
  const storage = new Web3Storage({ token: web3token2 });
  const file = await getFilesFromPath(filePath);
  const cid = await storage.put(file, { wrapWithDirectory: false });
  logger.info(`[ ${uploadedBy} ] Content added with CID: ${cid}`);
  if (fs.existsSync(filePath)) {
    fs.unlink(filePath, (err) => {
      if (err) throw err;
      // if no error, file has been deleted successfully
      logger.info(`File ${filePath} deleted!`);
    });
  }
  filesUploaded[fileName].cid = cid;
  filesUploaded[fileName].progress = 'uploaded';
  return cid;
}

app.get('/', (req, res) => {
  res.send({ version, app: 'dtube-web3storage-uploader' });
});

app.get('/progress/:token', (req, res) => {
  const { token } = req.params;
  if (typeof filesUploaded[req.params.token] !== 'undefined' && filesUploaded[req.params.token].progress !== null) {
    if (filesUploaded[req.params.token].progress === 'received') {
      uploadFile(web3token, token, req.headers['x-forwarded-for']);
      filesUploaded[req.params.token].progress = 'uploading';
      res.send(filesUploaded[req.params.token]);
    } else if (filesUploaded[req.params.token].progress === 'uploaded') {
      const tmp = filesUploaded[req.params.token];
      delete filesUploaded[req.params.token];
      res.send(tmp);
    } else {
      res.send(filesUploaded[req.params.token]);
    }
  } else {
    res.send({ status: 'error', error: 'Token not found.' });
  }
});

server.on(EVENTS.EVENT_UPLOAD_COMPLETE, (event) => {
  logger.info(`Receive complete for file ${event.file.id}`);
  filesUploaded[event.file.id] = {};
  filesUploaded[event.file.id].progress = 'received';
});

server.on(EVENTS.EVENT_ENDPOINT_CREATED, (event) => {
  const id = event.url.substring(event.url.lastIndexOf('/') + 1);
  logger.info(`Endpoint created with id ${id}`);
  filesUploaded[id] = {};
  filesUploaded[id].progress = 'waiting';
});

server.on(EVENTS.EVENT_FILE_CREATED, (event) => {
  filesUploaded[event.file.id] = {};
  filesUploaded[event.file.id].progress = 'receiving';
});

uploadApp.all('*', server.handle.bind(server));

app.use('/upload', uploadApp);

if (opts.daemon) {
  app.listen(port, () => {
    logger.info(`Listening on port ${port}`);
  });
  uploadApp.listen(1080, () => {
    logger.info('TUS listening on port 1080');
  });
}
