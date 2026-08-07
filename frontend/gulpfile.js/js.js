var fs = require('fs');
var path = require('path')
// Removed UglifyJS for human readable output
const { publicDir, languages, s, isDir, env} = require('./config');

const dir = process.cwd();
const js = [];
var taskCount = 0;
function loadJsToMemory() {
    let file = `pages_css_js_map.json`;
    let obj = JSON.parse(fs.readFileSync(file, 'utf8'));
    for(let page in obj){
        if (obj.hasOwnProperty(page)) {
            js[page] = js[page] ? js[page] : [];
            for (let index in obj[page]['js']) {
                if (obj[page]['js'].hasOwnProperty(index)) {
                    processJs(index, page, obj[page]['js'][index])
                    taskCount++;
                }
            }
        }
    }
}

function processJs(index, page, url) {
    let ext = path.extname(url)
    let isJs = ext === '.js' || ext === '.js'
    if (!isJs) {
        return false;
    }
    let base = path.basename(url);
    let isMinJs = base.includes('.min.js')
    if (!isMinJs) {
        mergeNonMinJsFile(index, page, url)
    } else {
        mergeMinJsFile(index, page, url)
    }
}

function mergeNonMinJsFile(index, page, url) {
    if (!fs.existsSync(url)) {
        console.log('WARNING !!!'+ url + ' FILE NOT EXIST')
        taskCount--;
        return;
    }
    fs.readFile(url, "utf8", function read(err, data) {
        if (err) {
            console.log('ERROR reading', url, err);
        } else {
            // Keep original JS content without minification
            js[page][index] = data;
        }
        taskCount--;
    })
}

function mergeMinJsFile(index, page, url) {
    if (!fs.existsSync(url)) {
        console.log('WARNING !!!'+ url + ' FILE NOT EXIST')
        taskCount--;
        return;
    }
    fs.readFile(url, "utf8", function read(err, data) {
        if (err) {
            throw err;
        }
        js[page][index] = ''+ data;
        taskCount--;
    });
}

function buildAllJs(cb) {
    if (env === 'dev') {
        let file = `pages_css_js_map.json`;
        let obj = JSON.parse(fs.readFileSync(file, 'utf8'));
        for(let page in obj){
            if (obj.hasOwnProperty(page)) {
                let directory = `${publicDir}${s}script`;
                if (!fs.existsSync(directory)){
                    fs.mkdirSync(directory, { recursive: true });
                }
                fs.writeFileSync(`${directory}${s}${page}.js`,'',{encoding:'utf8'})
                obj[page]['js'].forEach(fileLocation => {
                    let data = fs.readFileSync(fileLocation, "utf8");
                    data = data + ";\n";
                    fs.appendFileSync(`${directory}${s}${page}.js`,data,{encoding:'utf8'})
                });
            }
        }
        cb();
    }
    loadJsToMemory();
    setInterval(function () {
        if (taskCount === 0) {
            for (let page in js) {
                if (js.hasOwnProperty(page)) {
                    let content = js[page].join(";\n");
                        let directory = `${publicDir}${s}script`;
                        if (!fs.existsSync(directory)){
                            fs.mkdirSync(directory, { recursive: true });
                        }
                        fs.writeFileSync(`${directory}${s}${page}.js`,content,{encoding:'utf8'})
                }
            }
            cb();
            clearInterval(this);
        }
    }, 2);
}

exports.buildAllJs = buildAllJs;