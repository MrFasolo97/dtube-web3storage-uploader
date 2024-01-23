import net from 'net';
import log4js from 'log4js';
import util from 'util';
import javalon from 'javalon2';

log4js.configure({
  appenders: {
    logs: { type: 'file', filename: 'logs/logs.log' },
    console: { type: 'console' },
  },
  categories: {
    logs: { appenders: ['logs'], level: 'trace' },
    console: { appenders: ['console'], level: 'trace' },
    default: { appenders: ['console', 'logs'], level: 'info' },
  },
});

const port = 5081;

javalon.init({ api: 'https://dtube.fso.ovh' });
const LOG_LEVEL = 'debug';
const logger = log4js.getLogger();
logger.level = LOG_LEVEL;

async function authenticateRequest(base64signature) {
  logger.debug(base64signature);
  let signature = Buffer.from(base64signature, 'base64').toString('utf8');
  if (typeof signature === 'string') {
    try {
      signature = JSON.parse(signature);
    } catch (e) {
      logger.warn(e);
    }
  } else {
    logger.warn(`Type of signature= ${typeof signature}`);
  }
  // let signature = req.headers.signature;
  let r;
  let ownedKey;
  logger.debug(signature);
  if (typeof signature.username !== 'undefined' && typeof signature.ts !== 'undefined' && typeof signature.pubkey !== 'undefined') {
    await util.promisify(
      javalon.getAccount,
    )(signature.username).then((account) => {
      if (typeof account !== 'undefined') {
        for (let i = 0; i < account.keys.length; i += 1) {
          if (account.keys[i].pub === signature.pubkey) {
            ownedKey = true;
          }
        }
      }
      return false;
    }).catch((err) => {
      logger.error(err);
      return false;
    });

    const { ts } = signature;
    if (ts > (Date.now() - 3600000) && ownedKey) {
      try {
        r = javalon.signVerify(signature, signature.username, 3600000);
        if (r) {
          logger.debug('Got correct signature.');
          r = true;
        } else {
          r = false;
        }
      } catch (reason) {
        logger.debug('Invalid signature');
        logger.debug(reason);
        r = { status: 'error', error: 'Invalid signature!' };
      }
    } else if (!ownedKey) {
      logger.debug('Key not owned by user on chain!');
    } else if (typeof ts === 'number') {
      r = { status: 'error', error: 'Timestamp expired.' };
      logger.debug('Authentication not valid, timestamp expired!');
    } else if (typeof ts !== 'number') {
      r = {
        status: 'error',
        error: 'Invalid timestamp.',
        type: typeof ts,
        value: signature.ts,
      };
      logger.debug(typeof ts);
    } else {
      logger.debug('Authentication not valid, unknown error!');
    }
  } else {
    r = false;
    logger.warn('Auth not valid!');
  }
  return r;
}

const server = net.createServer();

server.on('connection', (clientToProxySocket) => {
  logger.debug('Client connected to proxy');
  let auth;
  clientToProxySocket.once('data', async (data) => {
    const needsAuth = true;
    let isTLSConnection = data.toString().indexOf('CONNECT') !== -1;
    isTLSConnection = false;
    const serverAddress = '127.0.0.1';
    const serverPort = 5083;
    // logger.debug(data.toString());
    logger.debug(serverAddress);
    if ((typeof auth === 'undefined' || auth === false) && needsAuth) {
      try {
        if (data.toString().indexOf('signature: ') !== -1) {
          auth = await authenticateRequest(data.toString().split('signature: ')[1].split('\r\n')[0]);
        } else {
          auth = false;
        }
      } catch (e) {
        logger.debug(e);
        auth = false;
      }
    }
    if ((auth !== false && needsAuth) || !needsAuth) {
      logger.debug(auth);
      // Creating a connection from proxy to destination server
      const proxyToServerSocket = net.createConnection(
        {
          host: serverAddress,
          port: serverPort,
        },
        () => {
          logger.debug('Proxy to server set up');
        },
      );

      if (isTLSConnection) {
        clientToProxySocket.write('HTTP/1.1 200 OK\r\n\r\n');
      } else {
        proxyToServerSocket.write(data);
      }

      clientToProxySocket.pipe(proxyToServerSocket);
      proxyToServerSocket.pipe(clientToProxySocket);

      proxyToServerSocket.on('error', (err) => {
        logger.error('Proxy to server error');
        logger.error(err);
        clientToProxySocket.write('HTTP/1.1 502 Bad Gateway\r\n\r\nBad Gateway\r\n\r\n');
        clientToProxySocket.end();
      });
      proxyToServerSocket.on('close', () => {
        logger.info('Server closed connection');
      });
      clientToProxySocket.on('error', (err) => {
        logger.error('Client to proxy error');
        logger.error(err);
        auth = undefined;
      });
      clientToProxySocket.on('close', () => {
        logger.info('Client closed connection');
        auth = undefined;
      });
    } else {
      clientToProxySocket.write('HTTP/1.1 401 Invalid Authentication\r\n\r\nInvalid Authentication\r\n\r\n');
      clientToProxySocket.end();
    }
  });
});

server.on('error', (err) => {
  logger.error('Some internal server error occurred');
  logger.error(err);
});

server.on('close', () => {
  logger.debug('Client disconnected');
});

server.listen(
  {
    host: '0.0.0.0',
    port,
  },
  () => {
    logger.info(`Server listening on 0.0.0.0:${port}`);
  },
);
