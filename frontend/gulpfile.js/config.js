var path = require('path')
var fs = require('fs');
const dir = process.cwd();
const langDir = `${dir}${path.sep}languages`;
const publicDir = `public`;
const s = path.sep; // Separator short form to reduce line
const languages = [
    'en',
    'ta'
];

const env = process.env.NODE_ENV ? process.env.NODE_ENV : 'prod';

function isDir(url) {
    return fs.lstatSync(url).isDirectory();
}

module.exports = {
    languages,
    langDir,
    publicDir,
    s,
    isDir,
    env,
};

