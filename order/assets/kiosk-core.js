(function attachKioskCore(root, factory) {
    const api = factory();
    if (typeof module === "object" && module.exports) module.exports = api;
    root.KioskCore = api;
})(typeof globalThis !== "undefined" ? globalThis : window, function createKioskCore() {
    const BRANCH_STORES = Object.freeze(["branch", "products", "cart", "images", "payment", "phonepe"]);

    function changeCartQuantity(cartData, product, productId, change) {
        const id = String(productId ?? "");
        const numericChange = Number(change) || 0;
        const currentCart = Array.isArray(cartData) ? cartData.map(item => ({ ...item })) : [];
        const existingIndex = currentCart.findIndex(item => String(item.id) === id);

        if (existingIndex === -1 && (!product || numericChange <= 0)) {
            return { cart: currentCart, item: null, quantity: 0 };
        }

        const item = existingIndex >= 0
            ? currentCart[existingIndex]
            : {
                id: String(product.id),
                name: product.name,
                img: product.img,
                price: product.price,
                tax_price: product.tax_price,
                quantity: 0
            };

        item.quantity = Math.max(0, (Number(item.quantity) || 0) + numericChange);

        if (item.quantity === 0) {
            return {
                cart: currentCart.filter(cartItem => String(cartItem.id) !== id),
                item,
                quantity: 0
            };
        }

        if (existingIndex >= 0) currentCart[existingIndex] = item;
        else currentCart.push(item);
        return { cart: currentCart, item, quantity: item.quantity };
    }

    function createSingleFlight() {
        let activePromise = null;

        return {
            isRunning: () => activePromise !== null,
            async run(operation) {
                if (activePromise) return activePromise;
                const currentPromise = Promise.resolve().then(operation);
                activePromise = currentPromise;
                try {
                    return await currentPromise;
                } finally {
                    if (activePromise === currentPromise) activePromise = null;
                }
            }
        };
    }

    function createPollingController(options) {
        const scheduler = options.scheduler || globalThis;
        const intervalMs = Number(options.intervalMs) || 5000;
        const timeoutMs = Number(options.timeoutMs) || 300000;
        let intervalId = null;
        let timeoutId = null;
        let running = false;
        let requestInFlight = false;

        const stop = () => {
            running = false;
            if (intervalId !== null) scheduler.clearInterval(intervalId);
            if (timeoutId !== null) scheduler.clearTimeout(timeoutId);
            intervalId = null;
            timeoutId = null;
        };

        const tick = async () => {
            if (!running || requestInFlight) return;
            requestInFlight = true;
            try {
                await options.poll({ stop });
            } finally {
                requestInFlight = false;
            }
        };

        const start = () => {
            stop();
            running = true;
            intervalId = scheduler.setInterval(tick, intervalMs);
            timeoutId = scheduler.setTimeout(() => {
                stop();
                Promise.resolve(options.onTimeout?.()).catch(error => console.error("Polling timeout handler failed:", error));
            }, timeoutMs);
            if (options.immediate) void tick();
        };

        return {
            start,
            stop,
            tick,
            isRunning: () => running,
            isRequestInFlight: () => requestInFlight
        };
    }

    return {
        BRANCH_STORES,
        changeCartQuantity,
        createSingleFlight,
        createPollingController
    };
});
