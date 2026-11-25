'use strict';

const fs = require('fs');
const path = require('path');

function renderProductVersion(html, version = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../package.json'), 'utf8')).version) {
    if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(version)) {
        throw new Error('Invalid root product version');
    }
    return html.replaceAll('__POSNIC_PRODUCT_VERSION__', version);
}

module.exports = { renderProductVersion };
