(function () {
    'use strict';
    var contract = window.PosnicPrintableMenuDesign;
    function node(tag, className, text) {
        var n = document.createElement(tag);
        n.className = className || '';
        if (text != null) n.textContent = String(text);
        return n;
    }
    function pattern(name, color, thumbnail) {
        if (contract.patterns.indexOf(name) === -1) return '';
        color = /^#[0-9a-f]{6}$/i.test(color || '') ? color : '#155e63';
        if (name === 'plain' && !thumbnail) return '';
        var drawings = {
            linen: '<path d="M0 0H40M0 20H40M0 0V40M20 0V40" stroke-width=".5"/>',
            coastal: '<path d="M-20 12Q0 -4 20 12T60 12M-20 32Q0 16 20 32T60 32" stroke-width="1.5"/>',
            botanical: '<path d="M0 40L40 0M10 30Q-4 5 20 20Q35 44 30 10" stroke-width="1"/>',
            deco: '<path d="M0 40L20 0L40 40M0 30L20 10L40 30M0 0H40" stroke-width="1"/>',
            dots: '<circle cx="10" cy="10" r="2"/><circle cx="30" cy="30" r="2"/>',
            diamonds: '<path d="M20 2L38 20L20 38L2 20Z" stroke-width="1"/>',
            chevron: '<path d="M0 8L20 24L40 8M0 28L20 44L40 28M0 -12L20 4L40 -12" stroke-width="1"/>',
            scallops: '<path d="M-20 0A20 20 0 0 0 20 0A20 20 0 0 0 60 0M-20 20A20 20 0 0 0 20 20A20 20 0 0 0 60 20" stroke-width="1"/>',
            bamboo: '<path d="M9 0V40M12 0V40M7 12H14M7 32H14M11 20Q23 5 30 9Q22 20 11 20M11 29Q-2 15 1 13" stroke-width="1"/>',
            petals: '<path d="M20 20C0 -4 0 44 20 20C44 0 -4 0 20 20C40 44 40 -4 20 20C-4 40 44 40 20 20Z" stroke-width="1"/>',
            hexagon: '<path d="M10 3H30L40 20L30 37H10L0 20Z" stroke-width="1"/>'
        };
        var svg = '<svg xmlns="http://www.w3.org/2000/svg" width="' + (thumbnail ? 120 : 800) + '" height="' + (thumbnail ? 80 : 1200) + '"><defs><pattern id="p" width="40" height="40" patternUnits="userSpaceOnUse"><g fill="none" stroke="' + color + '" opacity="' + (thumbnail ? 0.45 : 1) + '">' + (drawings[name] || '') + '</g></pattern></defs><rect width="100%" height="100%" fill="url(#p)"/></svg>';
        return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
    }
    function row(item, design, currency) {
        var article = node('div', 'pm-item');
        article.dataset.itemId = item.id;
        var line = node('div', 'pm-item-line');
        var name = node('div', 'pm-item-name');
        if (design.diet && item.diet) {
            var mark = node('span', 'pm-diet pm-diet-' + item.diet, item.diet === 'vegan' ? 'V' : '●');
            mark.title = { veg: 'Vegetarian', vegan: 'Vegan', egg: 'Contains egg', non_veg: 'Non-vegetarian' }[item.diet];
            mark.setAttribute('aria-label', mark.title);
            name.appendChild(mark);
        }
        name.appendChild(document.createTextNode(item.name));
        line.appendChild(name);
        line.appendChild(node('span', 'pm-price', (currency ? currency + ' ' : '') +
            Number(item.price).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })));
        article.appendChild(line);
        if (design.descriptions && item.description) article.appendChild(node('p', 'pm-description', item.description));
        return article;
    }
    function render(host, data, input) {
        var d = contract.normalize(input), size = contract.sizes[d.size];
        var width = Math.round(size[0] * 96 / 25.4), height = Math.round(size[1] * 96 / 25.4);
        host.replaceChildren();
        var pages = [], current, column, columnIndex;
        var categories = data.categories.filter(function (c) { return d.categories === null || d.categories.indexOf(c.id) !== -1; });
        var total = categories.reduce(function (n, c) { return n + c.items.length; }, 0);
        if (!total) return { pages: [], count: 0, design: d };
        function page() {
            current = node('section', 'pm-sheet pm-font-' + d.font);
            current.style.width = width + 'px'; current.style.height = height + 'px';
            current.style.fontSize = d.fontSize + 'px';
            current.style.setProperty('--pm-accent', d.accent);
            var bg = d.background || pattern(d.pattern, d.accent);
            if (bg) {
                var image = node('img', 'pm-background');
                image.src = bg; image.alt = ''; image.style.opacity = d.opacity;
                current.appendChild(image);
            }
            var header = node('header', 'pm-page-header');
            header.appendChild(node('div', 'pm-eyebrow', d.subtitle));
            header.appendChild(node('h2', 'pm-title', d.title || data.name || 'Menu'));
            current.appendChild(header);
            var footer = node('footer', 'pm-page-footer');
            footer.appendChild(node('div', 'pm-footer-text', d.footer));
            footer.appendChild(node('div', 'pm-page-number'));
            current.appendChild(footer);
            host.appendChild(current); pages.push(current);
            var columns = node('div', 'pm-columns');
            columns.style.top = (header.offsetTop + header.offsetHeight + 22) + 'px';
            columns.style.bottom = (height - footer.offsetTop + 22) + 'px';
            var colWidth = (width - 96 - (d.columns - 1) * 26) / d.columns;
            for (var i = 0; i < d.columns; i++) {
                var col = node('div', 'pm-column'); col.style.width = colWidth + 'px';
                columns.appendChild(col);
            }
            current.appendChild(columns);
            columnIndex = 0; column = columns.children[0];
            if (column.clientHeight < 100) throw new Error('Shorten the title or footer to leave room for the menu.');
        }
        function advance() {
            if (++columnIndex < d.columns) column = current.querySelectorAll('.pm-column')[columnIndex];
            else page();
        }
        function heading(name) { return node('h3', 'pm-category', name); }
        page();
        categories.forEach(function (category) {
            if (!category.items.length) return;
            var h = heading(category.name);
            var first = row(category.items[0], d, data.currency);
            column.appendChild(h); column.appendChild(first);
            if (column.scrollHeight > column.clientHeight) {
                h.remove(); first.remove(); advance();
                column.appendChild(h); column.appendChild(first);
            }
            if (column.scrollHeight > column.clientHeight) throw new Error('An item is too tall for this layout. Use one column, smaller text, or hide descriptions.');
            category.items.slice(1).forEach(function (item) {
                var r = row(item, d, data.currency);
                column.appendChild(r);
                if (column.scrollHeight > column.clientHeight) {
                    r.remove(); advance();
                    column.appendChild(heading(category.name)); column.appendChild(r);
                    if (column.scrollHeight > column.clientHeight) throw new Error('An item is too tall for this layout. Use one column, smaller text, or hide descriptions.');
                }
            });
        });
        pages.forEach(function (p, i) { p.querySelector('.pm-page-number').textContent = (i + 1) + ' / ' + pages.length; });
        return { pages: pages, count: total, design: d };
    }
    window.PosnicPrintableMenuRenderer = { render: render, pattern: pattern };
})();
