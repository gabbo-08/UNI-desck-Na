const Module = require('node:module');
const express = require('express');
const { db } = require('../../db');
const originalLoad = Module._load;
let scraperOpen = true;

function instrumentedExpress() {
  const app = express();
  app.get('/shutdown-probe', async (_req, res) => {
    process.send({ type: 'request-started' });
    await new Promise(resolve => setTimeout(resolve, 200));
    res.json({ databaseOpen: db.open, scraperOpen });
  });
  const listen = app.listen.bind(app);
  app.listen = (...args) => {
    args[0] = 0;
    const server = listen(...args);
    server.once('listening', () => process.send({ type: 'ready', port: server.address().port }));
    return server;
  };
  return app;
}
Object.assign(instrumentedExpress, express);

Module._load = function (request, parent, isMain) {
  if (parent?.filename === require.resolve('../../server')) {
    if (request === 'express') return instrumentedExpress;
    if (request === './scraper/pool') return {
      initCluster: async () => {},
      isClusterReady: () => scraperOpen,
      closeCluster: async () => { scraperOpen = false; }
    };
  }
  return originalLoad.call(this, request, parent, isMain);
};

process.on('message', message => {
  if (message === 'shutdown') process.emit('SIGTERM');
});
require('../../server');
