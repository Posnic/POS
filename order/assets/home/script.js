async function setKioskImagesFromIndexedDB() {
    try {
        const images = await getKioskImages();
        if (images) {
            updateKioskImageUI(images);
        }
    } catch (error) {
        console.warn("⚠ Could not load kiosk images:", error);
    }
}

document.addEventListener("DOMContentLoaded", async () => {
    await openDB(); // ensures DB is ready
    await setKioskImagesFromIndexedDB(); // now safe to call
});