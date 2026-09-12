/*
 * The resting screen learns whose shop it is.
 *
 * The name from the branch row, the logo and the home picture from the
 * images the shop uploaded for its machine - drawn only when they exist,
 * because a placeholder logo says "nobody set this up" to every customer.
 */
async function paintAttractScreen() {
    try {
        await openDB();
        if (typeof rememberShop === "function") {
            await rememberShop();
            const name = document.getElementById("attract-name");
            if (name && shop.name) {
                name.textContent = shop.name;
                document.title = shop.name;
            }
        }

        const images = await getKioskImages();
        if (!images) return;
        const apiBaseUrl = String(CONFIG.API_BASE_URL || "").replace(/\/$/, "");
        const resolve = (value, fallback) => {
            const raw = typeof value === "string" ? value.trim() : "";
            if (!raw || raw === fallback || raw === "images/" + fallback) return "";
            if (/^(https?:|data:|blob:)/i.test(raw)) return raw;
            return raw.startsWith("/") ? apiBaseUrl + raw : apiBaseUrl + "/" + raw.replace(/^\/+/, "");
        };

        const logo = document.getElementById("attract-logo");
        const logoSrc = resolve(images.logo, "default-product.png");
        if (logo && logoSrc) {
            logo.addEventListener("error", () => { logo.hidden = true; }, { once: true });
            logo.src = logoSrc;
            logo.hidden = false;
        }

        const picture = resolve(images.homebanner, "home.png");
        if (picture) {
            const probe = new Image();
            probe.onload = () => {
                document.body.style.backgroundImage = 'url("' + picture + '")';
                document.body.classList.add("has-picture");
            };
            probe.src = picture;
        }
    } catch (error) {
        console.warn("Could not paint the resting screen:", error);
    }
}

document.addEventListener("DOMContentLoaded", paintAttractScreen);
