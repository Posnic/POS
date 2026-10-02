'use strict';
// Standalone registry composition. Never mount this app in the till API.
const express = require('express');
const sessions = require('./services/extension-registry-sessions');
const rates = require('./services/extension-registry-rate-limit');
const { initializeLibrary } = require('./services/extension-private-library');
const { initializeInvitations } = require('./services/extension-library-invitations');
const { createLibraryRouter } = require('./routes/extension-library.routes');
const { createInvitationRouter } = require('./routes/extension-library-invitations.routes');
async function createExtensionRegistryApp({ db, client, readBlob, limits = {} } = {}) {
  if (!db || !client || typeof readBlob !== 'function') throw Error('registry_dependencies_required');
  await Promise.all([initializeLibrary(db), initializeInvitations(db), sessions.initializeSessions(db), rates.initializeRateLimits(db)]);
  const app = express();
  app.disable('x-powered-by');
  // Default to the socket peer, not attacker-supplied forwarded headers.
  app.set('trust proxy', false);
  app.use((req,res,next)=>{res.set('Cache-Control','private, no-store');res.set('X-Content-Type-Options','nosniff');next()});
  app.use(rates.createRegistryRateLimit({db,bucket:'registry-edge',limit:limits.edge ?? 120,windowMs:60000,subject:req=>req.socket.remoteAddress}));
  app.use(sessions.createRegistryAuthentication({db}));
  const authenticated = (req,res,next)=>next(); // Only reached through the session boundary above.
  const accountLimit = (bucket,limit)=>rates.createRegistryRateLimit({db,bucket,limit,windowMs:60000,subject:req=>req.libraryActor.id});
  app.use('/v1/library',accountLimit('registry-library',limits.library ?? 60),createLibraryRouter({db,authenticate:authenticated,readBlob}));
  app.use('/v1/invitations',accountLimit('registry-invitations',limits.invitations ?? 10),createInvitationRouter({db,client,authenticate:authenticated}));
  app.use((req,res)=>res.status(404).json({error:'Registry route not found.'}));
  app.use((error,req,res,next)=>{
    if(res.headersSent)return next(error);
    res.status(error.type==='entity.too.large'?413:error.type==='entity.parse.failed'?400:503).json({error:'Registry request could not be processed.'});
  });
  return app;
}
module.exports = { createExtensionRegistryApp };
