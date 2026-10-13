const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const puppeteer = require('../../api/node_modules/puppeteer');
const root = path.resolve(__dirname, '../..');

(async () => {
    const browser = await puppeteer.launch({headless: true});
    try {
        const page = await browser.newPage();
        const categories = ['All items', 'Beverages', 'Chicken Starters', 'Chinese Rice Noodles', 'Barbecue Chicken', 'Vegetarian Main Courses'];
        const cards = Array.from({length: 50}, (_, i) => `<button class="kv2-product"><span class="kv2-product-art">🍲</span><span class="kv2-product-text"><strong>Barbecue Chicken - Quarter ${i + 1}</strong><small></small><span class="kv2-product-meta"><small>Chicken Starters</small><b>₹ 170.00</b></span></span></button>`).join('');
        const markup = `<style>*{box-sizing:border-box}body{margin:0}</style><div id="kot_v2" class="kv2-composing"><div class="kv2-workspace"><section class="kv2-order kv2-editor"><header><h2>Add items</h2></header><div class="kv2-draft-body"><section class="kv2-catalogue"><div class="kv2-category-chips">${Array.from({length: 5}, () => categories.map(c => `<button>${c}</button>`).join('')).join('')}</div><div class="kv2-menu">${cards}</div></section><aside class="kv2-review">Review this round</aside></div><footer><button>Cancel</button><button>Send to kitchen</button></footer></section></div></div>`;

        const out = path.join(root, 'output/kot-catalogue-proof');
        fs.mkdirSync(out, {recursive: true});
        for (const [width, height, touch] of [[1654,1041,false], [1366,768,false], [1024,600,true], [768,900,true]]) {
            await page.setViewport({width, height, hasTouch: touch});
            await page.setContent(markup);
            await page.addStyleTag({path: path.join(root, 'frontend/static/style/css/modules/kot-v2.css')});
            const result = await page.evaluate(() => {
                const menu = document.querySelector('.kv2-menu');
                return {
                    cards: [...menu.children].every(card => {
                        const box = card.getBoundingClientRect();
                        return box.height >= 150 && [...card.querySelectorAll('strong,b')].every(e => e.getBoundingClientRect().bottom <= box.bottom);
                    }),
                    chips: [...document.querySelectorAll('.kv2-category-chips button')].every(e => e.scrollWidth <= e.clientWidth && e.getBoundingClientRect().height >= 44),
                    scrolls: menu.scrollHeight > menu.clientHeight,
                    pageFits: document.documentElement.scrollWidth <= innerWidth
                };
            });
            assert.deepEqual(result, {cards:true, chips:true, scrolls:true, pageFits:true}, `${width}x${height}, touch=${touch}`);
            await page.screenshot({path: path.join(out, `${width}x${height}.png`)});
        }
        console.log('PASS: 50 complete product cards, full category labels, touch targets and scrolling at four screen sizes.');
    } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });

