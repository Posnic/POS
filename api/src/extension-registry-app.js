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
  app.get('/v1/session/organizations',accountLimit('registry-account',limits.account ?? 60),async(req,res,next)=>{
    try {
      const after=req.query.after;
      if(Object.keys(req.query).some(key=>key!=='after') || (after!==undefined && (typeof after!=='string'||!/^[A-Za-z0-9_-]{1,100}$/.test(after))))
        return res.status(400).json({error:'Invalid organization cursor.'});
      const rows=await db.collection('library_memberships').find({userId:req.libraryActor.id,status:'active',
        ...(after?{organizationId:{$gt:after}}:{})},{projection:{_id:0,organizationId:1,role:1}}).sort({organizationId:1}).limit(51).toArray();
      res.json({organizations:rows.slice(0,50),next:rows.length>50?rows[49].organizationId:null});
    } catch(error){next(error)}
  });
  app.post('/v1/session/logout',async(req,res,next)=>{
    try {
      // Authentication above has already validated the exact bearer format.
      await sessions.revokeSession(db,req.headers.authorization.slice(7));
      res.status(204).end();
    }catch(error){next(error)}
  });
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
