const path = require('path');

function cloudLocalMongoUri(app, fallbackUri) {
  const userData = app.getPath('userData');
  const store = require(app.isPackaged
    ? path.join(process.resourcesPath, 'credentials-store')
    : path.join(__dirname, 'credentials-store'));
  const credentials = store.read([path.join(userData, '.mongodb-credentials.json')], userData, require('electron').safeStorage);
  if (credentials && credentials.uri) return credentials.uri;
  return fallbackUri || `mongodb://127.0.0.1:${process.env.POSNIC_MONGO_PORT || 47017}/PosnicPro`;
}

module.exports = { cloudLocalMongoUri };
