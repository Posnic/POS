var fs = require('fs');
var path = require('path')
const { minify } = require('terser');
const { publicDir, languages, s, isDir, env} = require('./config');

const dir = process.cwd();
const js = [];
var taskCount = 0;

/*
 * Minification (S1 feel-fast). "Removed UglifyJS for human readable output"
 * lived here for years while every till parsed a 6.8MB dashboard bundle on
 * every boot. Terser (uglify cannot parse the ES6 in the modules) minifies
 * each source file once per build - memoized, since core files appear in
 * every page's bundle - with top-level names untouched (the concatenated
 * bundle is one shared scope; only function-local names are mangled, so
 * window-attached objects and the inline onclick="PosnicPro..." handlers in
 * the HTML keep working). A file terser cannot parse ships unminified with a
 * warning: a slightly larger bundle beats a broken build.
 *
 * POSNIC_MINIFY=0 turns it off for debugging a production build locally.
 */
const MINIFY = process.env.POSNIC_MINIFY !== '0' && env !== 'dev';
const minified = new Map(); // url -> Promise<string>
const unminifiable = [];
function minifyFile(url, data) {
    if (!MINIFY) return Promise.resolve(data);
    if (minified.has(url)) return minified.get(url);
    const p = minify(data, { compress: true, mangle: true })
        .then((out) => (out && out.code ? out.code : data))
        .catch((err) => {
            unminifiable.push(`${url}: ${err.message}`);
            return data;
        });
    minified.set(url, p);
    return p;
}
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
            taskCount--;
            return;
        }
        minifyFile(url, data).then(function (code) {
            js[page][index] = code;
            taskCount--;
        });
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
            if (unminifiable.length) {
                console.warn(
                    `[minify] ${unminifiable.length} file(s) shipped unminified:\n  ` +
                    unminifiable.join('\n  ')
                );
            }
            cb();
            clearInterval(this);
        }
    }, 2);
}

exports.buildAllJs = buildAllJs;