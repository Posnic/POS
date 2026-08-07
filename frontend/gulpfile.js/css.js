var fs = require('fs');
var path = require('path')
var sass = require('sass');
const { publicDir, languages, s, isDir} = require('./config');
const dir = process.cwd();
const css = [];
var taskCount = 0;
function loadCssToMemory() {
    let file = `pages_css_js_map.json`;
    let obj = JSON.parse(fs.readFileSync(file, 'utf8'));
    for(let page in obj){
        if (obj.hasOwnProperty(page)) {
            css[page] = css[page] ? css[page] : [];
            for (let index in obj[page]['css']) {
                if (obj[page]['css'].hasOwnProperty(index)) {
                    minifyCss(index, page, obj[page]['css'][index])
                    taskCount++;
                }
            }
        }
    }
}

function minifyCss(index, page, url) {
    let ext = path.extname(url)
    let isCss = ext === '.css' || ext === '.scss'
    if (!isCss) {
        return false;
    }
    let base = path.basename(url);
    let isMinCss = base.includes('.min.css')
    if (!isMinCss) {
        mergeNonMinCssFile(index, page, url)
    } else {
        mergeMinCssFile(index, page, url)
    }
}

function mergeNonMinCssFile(index, page, url) {
    if (!fs.existsSync(url)) {
        console.log('WARNING !!!'+ url + ' FILE NOT EXIST')
        taskCount--;
        return;
    }
    sass.render({file: url, outputStyle: 'compressed'}, function(error, result) {
        if (error) {
            console.log(error)
        }
        css[page][index] = ''+result.css
        taskCount--;
    });
}

function mergeMinCssFile(index, page, url) {
    if (!fs.existsSync(url)) {
        console.log('WARNING !!!'+ url + ' FILE NOT EXIST')
        taskCount--;
        return;
    }
    fs.readFile(url, "utf8", function read(err, data) {
        if (err) {
            throw err;
        }
        css[page][index] = ''+ data;
        taskCount--;
    });
}

function buildAllCss(cb) {
    loadCssToMemory();
    setInterval(function () {
        if (taskCount === 0) {
            for (let page in css) {
                if (css.hasOwnProperty(page)) {
                    let content = css[page].join("\n");
                    languages.forEach(lang => {
                        let directory = `${publicDir}${s}style`;
                        if (!fs.existsSync(directory)){
                            fs.mkdirSync(directory, { recursive: true });
                        }
                        fs.writeFileSync(`${directory}${s}${page}.css`,content,{encoding:'utf8'})
                    });
                }
            }
            cb();
            clearInterval(this);
        }
    }, 2);
}

exports.buildAllCss = buildAllCss;